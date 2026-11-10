import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { assertApplicationAccess, assertApplicationsAccess, coordinatorScope } from '../common/scope';
import { AuditService, StorageService } from '../common/services';
import { JoiningRecord } from '../database/entities';
import { CandidatesService } from '../candidates/candidates.service';
import { EvaluationService } from '../evaluation/evaluation.service';
import { JoiningService } from '../joining/joining.service';
import { ApplicationStatus, BulkDeleteDto, CvBankQuery, StatusChangeDto } from './cv-bank.dto';

/** Single SQL definition of the derived status. Needs aliases `a` (applications) and `j` (joining_records, LEFT JOIN). */
export const STATUS_SQL = `(CASE
  WHEN j.status = 'Approved' THEN 'Joined'
  WHEN j.status = 'Rejected' THEN 'Rejected'
  WHEN a."finalDecision" <> 'Pending' THEN a."finalDecision"
  WHEN EXISTS (SELECT 1 FROM candidate_stages s WHERE s."applicationId" = a.id) THEN 'Interview'
  WHEN a.shortlisted THEN 'Shortlisted'
  WHEN a."screeningResult" IS NOT NULL THEN a."screeningResult"
  WHEN a."processingStatus" = 'Failed' THEN 'Review Required'
  WHEN a."processingStatus" IN ('Received', 'Unmatched') THEN 'Received'
  ELSE 'Screening' END)`;

/** Workflow transitions available from each derived status. Received/Screening/Pass/Fail are set by the system only. */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  Received: [],
  Screening: [],
  Pass: ['Shortlisted'],
  Fail: ['Shortlisted'],
  'Review Required': ['Shortlisted'],
  Shortlisted: ['Interview', 'Selected', 'Not Selected', 'On Hold'], // + back to its screening result (un-shortlist)
  Interview: ['Selected', 'Not Selected', 'On Hold'],
  'On Hold': ['Selected', 'Not Selected'],
  Selected: ['Joined', 'Not Selected', 'On Hold'],
  'Not Selected': ['Selected', 'On Hold'],
  Joined: [],
  Rejected: [], // reopened from the Joining page only
};

export interface StatusRow { status: ApplicationStatus; screeningResult: string | null }

export interface TransitionOption { status: ApplicationStatus; reasonRequired: boolean; needsJoiningDate?: boolean; allowsSchedule?: boolean }

/** Targets this user may move the application to, with the inputs each needs. Permissions mirror the delegated actions. */
export function allowedTransitions(row: StatusRow, me: AuthUser): TransitionOption[] {
  const out: TransitionOption[] = [];
  const has = (p: string) => me.permissions.has(p);
  for (const to of TRANSITIONS[row.status] ?? []) {
    if (to === 'Shortlisted') {
      if (!has(P.SHORTLIST) || (row.status !== 'Pass' && !has(P.SHORTLIST_OVERRIDE))) continue;
      out.push({ status: to, reasonRequired: row.status === 'Fail' });
    } else if (to === 'Interview') {
      if (has(P.SHORTLIST)) out.push({ status: to, reasonRequired: false, allowsSchedule: true });
    } else if (to === 'Joined') {
      if (has(P.JOINING_APPROVE)) out.push({ status: to, reasonRequired: false, needsJoiningDate: true });
    } else if (has(P.FINAL_DECISION)) {
      // Reversing a decision needs a recorded reason.
      const reversal = row.status === 'Not Selected' || row.status === 'Selected';
      out.push({ status: to, reasonRequired: reversal });
    }
  }
  if (row.status === 'Shortlisted' && has(P.SHORTLIST)) {
    out.push({ status: (row.screeningResult ?? 'Review Required') as ApplicationStatus, reasonRequired: true });
  }
  return out;
}

@Injectable()
export class CvBankService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly candidates: CandidatesService,
    private readonly evaluation: EvaluationService,
    private readonly joining: JoiningService,
  ) {}

  /** WHERE clause for filters, built with positional parameters; applied on the server for every query. */
  private where(q: CvBankQuery & { applicationId?: string }, scope: 'app' | 'vacancy', me: AuthUser) {
    const conds: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
    const coordinator = coordinatorScope(me);
    if (coordinator) add('v."coordinatorId" = ?', coordinator);
    if (q.departmentId) add('v."departmentId" = ?', q.departmentId);
    if (q.vacancyId) add('v.id = ?', q.vacancyId);
    const match: string[] = [];
    if (q.applicationId) { params.push(q.applicationId); match.push(`a.id = $${params.length}`); }
    if (q.q?.trim()) {
      params.push(`%${q.q.trim()}%`);
      const n = `$${params.length}`;
      match.push(`(cd.name ILIKE ${n} OR cd."candidateNo" ILIKE ${n} OR a."applicationNo" ILIKE ${n} OR cd.email ILIKE ${n})`);
    }
    if (q.status) { params.push(q.status); match.push(`${STATUS_SQL} = $${params.length}`); }
    if (scope === 'app') conds.push(...match);
    return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', match: match.length ? match.join(' AND ') : 'TRUE', params };
  }

  /** Department -> vacancy hierarchy with total and filter-matching application counts. */
  async tree(q: CvBankQuery, me: AuthUser) {
    const { where, match, params } = this.where(q, 'vacancy', me);
    const vacancies: any[] = await this.ds.query(
      `SELECT v.id, v."vacancyNo", v."positionTitle", v.status, v.headcount, v."departmentId", v.source,
              co.code AS "companyCode", co.name AS "companyName",
              count(a.id)::int AS total, count(a.id) FILTER (WHERE ${match})::int AS matching
         FROM vacancies v
         JOIN companies co ON co.id = v."companyId"
         LEFT JOIN applications a ON a."vacancyId" = v.id
         LEFT JOIN candidates cd ON cd.id = a."candidateId"
         LEFT JOIN joining_records j ON j."applicationId" = a.id
         ${where}
        GROUP BY v.id, co.code, co.name
        ORDER BY v."createdAt" DESC`, params);
    const departments: any[] = await this.ds.query(
      `SELECT id, code, name FROM departments
        WHERE (active OR id IN (SELECT "departmentId" FROM vacancies)) ${q.departmentId ? 'AND id = $1' : ''}
        ORDER BY name`, q.departmentId ? [q.departmentId] : []);
    return {
      filtered: !!(q.q?.trim() || q.status),
      departments: departments.map((d) => {
        const vs = vacancies.filter((v) => v.departmentId === d.id);
        return { ...d, vacancies: vs, total: vs.reduce((s, v) => s + v.total, 0), matching: vs.reduce((s, v) => s + v.matching, 0) };
      }),
    };
  }

  /** Candidate applications (one row per application) with all list columns in a single query. */
  async applications(q: CvBankQuery & { applicationId?: string }, me: AuthUser) {
    const { where, params } = this.where(q, 'app', me);
    const from = `
      FROM applications a
      JOIN candidates cd ON cd.id = a."candidateId"
      JOIN vacancies v ON v.id = a."vacancyId"
      JOIN departments d ON d.id = v."departmentId"
      JOIN companies co ON co.id = v."companyId"
      LEFT JOIN joining_records j ON j."applicationId" = a.id`;
    const { skip, take } = skipTake(q);
    const [rows, count] = await Promise.all([
      this.ds.query(
        `SELECT a.id AS "applicationId", a."applicationNo", a."screeningResult", a."processingStatus", a."duplicateReview",
                a.shortlisted, a."finalDecision",
                cd.id AS "candidateId", cd."candidateNo", cd.name, cd.email, cd.phone,
                v.id AS "vacancyId", v."vacancyNo", v."positionTitle", d.id AS "departmentId", d.name AS department,
                co.code AS "companyCode", co.name AS company, j.status AS "joiningStatus",
                ${STATUS_SQL} AS status,
                doc.id AS "documentId", doc."originalName" AS "documentName", coalesce(doc."hasFile", false) AS "hasFile",
                -- The must-haves and the match score; a requirement line that only adds to the score is not counted on its own.
                (SELECT count(*)::int FROM jsonb_array_elements(sr.results) e WHERE e->>'outcome' = 'Pass' AND (sr.basis = 'JOB_POST' OR (e->>'mandatory')::boolean)) AS "criteriaMet",
                (SELECT count(*)::int FROM jsonb_array_elements(sr.results) e WHERE sr.basis = 'JOB_POST' OR (e->>'mandatory')::boolean) AS "criteriaTotal", a."screeningScore"::float AS "screeningScore", sr."criteriaVersion", sr.basis AS "screeningBasis",
                rm.text AS "latestRemark", coalesce(rm.n, 0)::int AS "remarkCount",
                GREATEST(a."updatedAt", stg.t, j."updatedAt", rm."createdAt") AS "lastUpdated"
         ${from}
         LEFT JOIN screening_runs sr ON sr.id = a."latestScreeningRunId"
         LEFT JOIN LATERAL (SELECT id, "originalName", "storageKey" IS NOT NULL AS "hasFile" FROM candidate_documents WHERE "applicationId" = a.id ORDER BY "createdAt" DESC LIMIT 1) doc ON true
         LEFT JOIN LATERAL (SELECT text, "createdAt", count(*) OVER () AS n FROM candidate_remarks WHERE "applicationId" = a.id ORDER BY "createdAt" DESC LIMIT 1) rm ON true
         LEFT JOIN LATERAL (SELECT max("updatedAt") AS t FROM candidate_stages WHERE "applicationId" = a.id) stg ON true
         ${where}
         ORDER BY d.name, v."vacancyNo", cd.name NULLS LAST, a."applicationNo"
         OFFSET ${skip} LIMIT ${take}`, params),
      this.ds.query(`SELECT count(*)::int AS n ${from} ${where}`, params),
    ]);
    const items = rows.map((r: any) => ({ ...r, transitions: allowedTransitions(r, me) }));
    return paged(items, count[0].n, q);
  }

  private async current(applicationId: string) {
    const rows = await this.ds.query(
      `SELECT a.id, a."vacancyId", a."applicationNo", a."screeningResult", ${STATUS_SQL} AS status
         FROM applications a LEFT JOIN joining_records j ON j."applicationId" = a.id WHERE a.id = $1`, [applicationId]);
    if (!rows.length) throw new NotFoundException('Application not found.');
    return rows[0] as { id: string; vacancyId: string; applicationNo: string; screeningResult: string | null; status: ApplicationStatus };
  }

  /**
   * Moves ONE application to a new status by calling the existing workflow action for that step,
   * so its validation, permissions and audit still apply. Other applications of the same candidate are untouched.
   */
  async changeStatus(applicationId: string, dto: StatusChangeDto, me: AuthUser) {
    await assertApplicationAccess(this.ds, me, applicationId);
    const app = await this.current(applicationId);
    if (app.status !== dto.fromStatus) {
      throw new ConflictException(`This application is now "${app.status}" (you saw "${dto.fromStatus}"). Refresh and try again.`);
    }
    if (dto.status === app.status) return this.row(applicationId, me);
    const option = allowedTransitions(app, me).find((t) => t.status === dto.status);
    if (!option) {
      const possible = (TRANSITIONS[app.status] ?? []).includes(dto.status) || (app.status === 'Shortlisted' && dto.status === (app.screeningResult ?? 'Review Required'));
      if (possible) throw new ForbiddenException(`You do not have permission to move an application to "${dto.status}".`);
      throw new BadRequestException(`An application cannot move from "${app.status}" to "${dto.status}".`);
    }
    const reason = dto.reason?.trim() || undefined;
    if (option.reasonRequired && (!reason || reason.length < 3)) throw new BadRequestException({ message: 'A reason is required for this status change.', fieldErrors: { reason: 'Enter a reason (at least 3 characters).' } });

    switch (dto.status) {
      case 'Shortlisted':
      case 'Pass':
      case 'Fail':
      case 'Review Required': {
        const shortlisted = dto.status === 'Shortlisted';
        const [res] = await this.candidates.shortlist(app.vacancyId, [applicationId], shortlisted, reason, me);
        if (!res?.ok) throw new BadRequestException(res?.error ?? 'Shortlist update failed.');
        break;
      }
      case 'Interview':
        await this.evaluation.upsertStage(applicationId, 'INTERVIEW', { scheduledAt: dto.scheduledAt ?? null, location: dto.location ?? null }, me);
        break;
      case 'Selected':
      case 'Not Selected':
      case 'On Hold':
        await this.evaluation.finalDecision(applicationId, dto.status, reason, me);
        break;
      case 'Joined': {
        if (!dto.joiningDate) throw new BadRequestException({ message: 'Enter the verified joining date.', fieldErrors: { joiningDate: 'Joining date is required.' } });
        const rec = await this.ds.getRepository(JoiningRecord).findOne({ where: { applicationId } });
        if (!rec) throw new ConflictException('No joining record exists; record the final decision as Selected first.');
        await this.joining.approve(rec.id, { joiningDate: dto.joiningDate, remarks: reason }, me);
        break;
      }
      default:
        throw new BadRequestException(`"${dto.status}" is set by the system and cannot be chosen manually.`);
    }

    const after = await this.current(applicationId);
    await this.audit.log(this.ds.manager, me, 'application.status_change', 'Application', applicationId, {
      label: app.applicationNo, old: { status: app.status }, new: { status: after.status, reason: reason ?? null },
    });
    return this.row(applicationId, me);
  }

  private async row(applicationId: string, me: AuthUser) {
    const res = await this.applications({ applicationId, page: 1, pageSize: 1 } as any, me);
    return res.items[0];
  }

  /**
   * Permanently deletes the given applications and everything under them (owner, 2026-11-09):
   * documents and files, extraction/screening runs, stages, marks, remarks, pending joining
   * records, emails and intake links pointing at them, processing jobs and notifications.
   * Applications of candidates who have **Joined** (any approved joining record anywhere) are
   * refused up front with 409, so joined-candidate records are never touched. Candidates left
   * with no other application are deleted too; a candidate who also applied elsewhere is kept.
   * Stored files are erased after the commit. One `candidate.bulk_delete` audit entry records
   * the counts.
   */
  async bulkDelete(dto: BulkDeleteDto, me: AuthUser) {
    await assertApplicationsAccess(this.ds, me, dto.ids);
    const files: string[] = [];
    const result = await this.ds.transaction(async (m) => {
      const q = async (sql: string, params: unknown[]) => m.query(sql, params) as Promise<any[]>;
      const ids = async (sql: string, params: unknown[]) => (await q(sql, params)).map((x) => x.id as string);
      const del = async (sql: string, params: unknown[]) => Number((await m.query(sql, params))[1] ?? 0);
      const apps = await ids(`SELECT id FROM applications WHERE id = ANY($1::uuid[])`, [dto.ids]);
      if (!apps.length) throw new NotFoundException('No matching applications to delete.');

      // A joined candidate must not be deleted: not this application, and not any other
      // application of a candidate who has joined anywhere (their records are kept elsewhere).
      const joined = await q(
        `SELECT a."applicationNo" AS app, cd.name, cd."candidateNo"
           FROM applications a JOIN candidates cd ON cd.id = a."candidateId"
          WHERE a.id = ANY($1::uuid[])
            AND EXISTS (SELECT 1 FROM joining_records j
                          JOIN applications a2 ON a2.id = j."applicationId"
                         WHERE a2."candidateId" = cd.id AND j.status = 'Approved')
          ORDER BY a."applicationNo"`,
        [apps]);
      if (joined.length) {
        const names = joined.slice(0, 5).map((r: any) => `${r.app} (${r.name ?? r.candidateNo})`).join(', ');
        const more = joined.length > 5 ? ` and ${joined.length - 5} more` : '';
        throw new ConflictException(
          `${joined.length} selected CV${joined.length === 1 ? ' is' : 's are'} of candidates who have already joined — these cannot be deleted so their joining records stay intact: ${names}${more}.`);
      }
      const cands = (await q(`SELECT DISTINCT "candidateId" AS id FROM applications WHERE id = ANY($1::uuid[])`, [apps])).map((x) => x.id as string);
      const labels = (await q(`SELECT a."applicationNo" AS app, cd.name, cd."candidateNo" FROM applications a JOIN candidates cd ON cd.id = a."candidateId" WHERE a.id = ANY($1::uuid[])`, [apps]));
      const events = await ids(`SELECT id FROM email_events WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
      files.push(...(await q(`SELECT "storageKey" FROM candidate_documents WHERE "applicationId" = ANY($1::uuid[]) AND "storageKey" IS NOT NULL`, [apps])).map((x) => x.storageKey));

      const counts: Record<string, number> = {};
      const refs = [...apps, ...events];
      await del(`DELETE FROM processing_jobs WHERE "refId" = ANY($1::uuid[])`, [refs]);
      await del(`DELETE FROM notifications WHERE link = ANY($1::text[])`, [apps.map((a) => `/applications/${a}`)]);
      const batches = (await q(`SELECT DISTINCT "batchId" AS id FROM email_events WHERE id = ANY($1::uuid[])`, [events])).map((x) => x.id as string);
      counts.emails = await del(`DELETE FROM email_events WHERE id = ANY($1::uuid[])`, [events]);
      await del(`DELETE FROM email_batches b WHERE b.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e."batchId" = b.id)`, [batches]);
      counts.joining = await del(`DELETE FROM joining_records WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
      counts.marks = await del(`DELETE FROM evaluation_marks WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
      for (const t of ['candidate_stages', 'candidate_remarks', 'screening_runs', 'extraction_runs', 'candidate_documents']) {
        await del(`DELETE FROM ${t} WHERE "applicationId" = ANY($1::uuid[])`, [apps]);
      }
      // Unlink deleted applications from any intake mail attachments pointing at them.
      await m.query(
        `UPDATE intake_messages SET attachments = COALESCE((
            SELECT jsonb_agg(CASE WHEN (a->>'applicationId') = ANY($1::text[]) THEN a - 'applicationId' ELSE a END)
              FROM jsonb_array_elements(attachments) a), '[]'::jsonb)
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(attachments) a WHERE (a->>'applicationId') = ANY($1::text[]))`,
        [apps]);
      counts.applications = await del(`DELETE FROM applications WHERE id = ANY($1::uuid[])`, [apps]);
      const orphans = await ids(`SELECT c.id FROM candidates c WHERE c.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM applications a WHERE a."candidateId" = c.id)`, [cands]);
      await m.query(`UPDATE applications SET "suspectedDuplicateCandidateId" = NULL, "duplicateReview" = CASE WHEN "duplicateReview" = 'PENDING' THEN 'NONE' ELSE "duplicateReview" END WHERE "suspectedDuplicateCandidateId" = ANY($1::uuid[])`, [orphans]);
      counts.candidates = await del(`DELETE FROM candidates WHERE id = ANY($1::uuid[])`, [orphans]);

      const reason = dto.reason?.trim() || null;
      await this.audit.log(m, me, 'candidate.bulk_delete', 'Application', apps[0], {
        label: `${apps.length} CV${apps.length === 1 ? '' : 's'}`,
        old: { applications: labels.map((l) => ({ applicationNo: l.app, candidateNo: l.candidateNo, name: l.name })) },
        new: { reason, deleted: counts },
      });
      return { deleted: true, counts };
    });
    for (const key of files) this.storage.remove(key);
    return result;
  }
}
