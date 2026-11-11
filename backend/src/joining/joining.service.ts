import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { coordinatorScope, departmentScope } from '../common/scope';
import { AuditService, diff, NotificationService } from '../common/services';
import { Application, JoiningRecord, ManpowerQuota, Vacancy } from '../database/entities';
import { ApproveDto, JoinedQuery, JoiningUpdateDto } from './joining.dto';

@Injectable()
export class JoiningService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly audit: AuditService, private readonly notify: NotificationService) {}

  private base(status: JoiningRecord['status']) {
    return this.ds.getRepository(JoiningRecord).createQueryBuilder('j')
      .innerJoinAndSelect('j.application', 'a').innerJoinAndSelect('a.candidate', 'c')
      .innerJoinAndSelect('a.vacancy', 'v').leftJoinAndSelect('v.department', 'd').leftJoinAndSelect('v.company', 'co')
      .where('j.status = :st', { st: status });
  }

  /** Who sees which joining records: every vacancy, the vacancies I coordinate, or (department users) their Joining access scope. */
  private scope(qb: ReturnType<JoiningService['base']>, me: AuthUser) {
    const coordinator = coordinatorScope(me);
    if (!coordinator) return;
    if (me.permissions.has(P.VACANCY_VIEW)) { qb.andWhere('v.coordinatorId = :me', { me: coordinator }); return; }
    const departments = departmentScope(me, 'joining');
    if (departments) qb.andWhere('v.departmentId = ANY(:departments)', { departments });
  }

  async pending(me: AuthUser) {
    const qb = this.base('Pending').orderBy('a.finalDecisionAt', 'ASC');
    this.scope(qb, me);
    return this.withSeats(await qb.getMany());
  }

  async rejected(me: AuthUser) {
    const qb = this.base('Rejected').orderBy('j.updatedAt', 'DESC');
    this.scope(qb, me);
    return this.withSeats(await qb.getMany());
  }

  /** Each row with its vacancy's headcount, approved joinings, and the newest CV document (for download / bulk CV pack). */
  private async withSeats(rows: JoiningRecord[]) {
    const vacancyIds = [...new Set(rows.map((j) => j.application.vacancyId))];
    const appIds = rows.map((j) => j.applicationId);
    const [counts, docs] = await Promise.all([
      vacancyIds.length ? this.ds.query(
        `SELECT a."vacancyId", count(*)::int AS n FROM joining_records jr JOIN applications a ON a.id = jr."applicationId"
          WHERE jr.status = 'Approved' AND a."vacancyId" = ANY($1) GROUP BY a."vacancyId"`, [vacancyIds]) : [],
      appIds.length ? this.ds.query(
        `SELECT DISTINCT ON ("applicationId") "applicationId", id, "originalName", ("storageKey" IS NOT NULL) AS "hasFile"
           FROM candidate_documents WHERE "applicationId" = ANY($1::uuid[])
          ORDER BY "applicationId", "createdAt" DESC`, [appIds]) : [],
    ]);
    const joined = new Map((counts as any[]).map((c) => [c.vacancyId, c.n]));
    const docByApp = new Map<string, { id: string; originalName: string; hasFile: boolean }>((docs as any[]).map((d) => [d.applicationId, { id: d.id, originalName: d.originalName, hasFile: d.hasFile }]));
    return rows.map((j) => ({ ...this.view(j), headcount: j.application.vacancy.headcount, joinedCount: joined.get(j.application.vacancyId) ?? 0,
      documentId: docByApp.get(j.applicationId)?.id ?? null, documentName: docByApp.get(j.applicationId)?.originalName ?? null, hasFile: !!docByApp.get(j.applicationId)?.hasFile }));
  }

  async joined(q: JoinedQuery, me: AuthUser) {
    const qb = this.base('Approved').leftJoin('users', 'u', 'u.id = j.approvedById').addSelect('u.name', 'approver').orderBy('j.joiningDate', 'DESC');
    this.scope(qb, me);
    // Candidate contact details stay with recruitment users; department users see who joined, not how to reach them.
    const contacts = me.permissions.has(P.CANDIDATE_VIEW);
    if (q.departmentId) qb.andWhere('v.departmentId = :d', { d: q.departmentId });
    if (q.position) qb.andWhere('v.positionTitle ILIKE :p', { p: `%${q.position}%` });
    if (q.from) qb.andWhere('j.joiningDate >= :f', { f: q.from });
    if (q.to) qb.andWhere('j.joiningDate <= :t', { t: q.to });
    if (q.q) qb.andWhere(new Brackets((w) => w.where('c.name ILIKE :q').orWhere('c.candidateNo ILIKE :q').orWhere('a.applicationNo ILIKE :q').orWhere('v.vacancyNo ILIKE :q')), { q: `%${q.q}%` });
    const total = await qb.getCount();
    const { skip, take } = skipTake(q);
    const { entities, raw } = await qb.offset(skip).limit(take).getRawAndEntities();
    const appIds = entities.map((j) => j.applicationId);
    const docs = appIds.length ? await this.ds.query(
      `SELECT DISTINCT ON ("applicationId") "applicationId", id, "originalName", ("storageKey" IS NOT NULL) AS "hasFile"
         FROM candidate_documents WHERE "applicationId" = ANY($1::uuid[])
        ORDER BY "applicationId", "createdAt" DESC`, [appIds]) : [];
    const docByApp = new Map<string, any>((docs as any[]).map((d) => [d.applicationId, d]));
    return paged(entities.map((j) => {
      const d = docByApp.get(j.applicationId);
      const row = { ...this.view(j), approvedBy: raw.find((r) => r.j_id === j.id)?.approver ?? null,
        documentId: d?.id ?? null, documentName: d?.originalName ?? null, hasFile: !!d?.hasFile };
      // Department users do not see the salary either (owner, 2026-11-09: kept with recruitment).
      return contacts ? row : { ...row, email: null, phone: null, salary: null };
    }), total, q);
  }

  private view(j: JoiningRecord) {
    const a = j.application;
    return {
      id: j.id, joiningDate: j.joiningDate, status: j.status, letterStatus: j.letterStatus, salary: j.salary, remarks: j.remarks, approvedAt: j.approvedAt, updatedAt: j.updatedAt,
      applicationId: a.id, applicationNo: a.applicationNo, candidateNo: a.candidate.candidateNo, name: a.candidate.name,
      email: a.candidate.email, phone: a.candidate.phone, finalDecision: a.finalDecision, finalDecisionAt: a.finalDecisionAt,
      vacancyId: a.vacancy.id, vacancyNo: a.vacancy.vacancyNo, position: a.vacancy.positionTitle, vacancyStatus: a.vacancy.status,
      department: a.vacancy.department?.name, company: a.vacancy.company?.name,
    };
  }

  async update(id: string, body: JoiningUpdateDto, me: AuthUser) {
    // Only the fields the request sent; the salary is trimmed and an empty one clears it.
    const dto = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as JoiningUpdateDto;
    if (dto.salary !== undefined) dto.salary = dto.salary?.trim() || null;
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!j) throw new NotFoundException();
      if (j.status !== 'Pending') throw new ConflictException(`Joining record is ${j.status}.`);
      const d = diff(j, { ...j, ...dto }, Object.keys(dto));
      Object.assign(j, dto);
      await m.save(j);
      if (d.changed.length) await this.audit.log(m, me, 'joining.update', 'Application', j.applicationId, d);
      return j;
    });
  }

  /** Manual HR approval of actual joining; repeated clicks never duplicate (SRS 14.3 / AC-23). */
  async approve(id: string, dto: ApproveDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!j) throw new NotFoundException();
      if (j.status === 'Approved') return { joining: j, duplicate: true };
      if (j.status !== 'Pending') throw new ConflictException(`Joining record is ${j.status}.`);
      const app = await m.findOneOrFail(Application, { where: { id: j.applicationId } });
      if (app.finalDecision !== 'Selected') throw new ConflictException('Only final-selected candidates can be approved as joined.');
      // The vacancy is locked before counting, so two approvals at once cannot both take the last seat.
      const v = await m.findOneOrFail(Vacancy, { where: { id: app.vacancyId }, lock: { mode: 'pessimistic_write' } });
      const countJoined = () => m.createQueryBuilder(JoiningRecord, 'jr').innerJoin(Application, 'a', 'a.id = jr.applicationId')
        .where(`a.vacancyId = :v AND jr.status = 'Approved'`, { v: v.id }).getCount();
      // No joining beyond the approved headcount (owner, 2026-11-05).
      const before = await countJoined();
      if (before >= v.headcount) {
        throw new ConflictException(`All ${v.headcount} seat${v.headcount === 1 ? '' : 's'} of ${v.vacancyNo} are already filled (${before} joined), so no more joinings can be approved. Reject this candidate at joining, or raise a new requisition for more seats.`);
      }
      Object.assign(j, { status: 'Approved', joiningDate: dto.joiningDate, remarks: dto.remarks ?? j.remarks, approvedById: me.id, approvedAt: new Date() });
      await m.save(j);
      await this.audit.log(m, me, 'joining.approve', 'Application', j.applicationId, { label: app.applicationNo, old: { status: 'Pending' }, new: { status: 'Approved', joiningDate: dto.joiningDate } });

      // A joining raises the present manpower of the dept-total and (if present) the matching designation row by one;
      // a joining undone later drops them back (owner, 2026-11-09). Baseline stays whatever the admin set.
      await this.adjustManpower(m, v, +1, me);

      // Mark the vacancy Filled once approved joinings reach its headcount.
      const joinedCount = before + 1;
      if (joinedCount >= v.headcount && v.status !== 'Filled') {
        const old = v.status;
        v.status = 'Filled';
        await m.save(v);
        await this.audit.log(m, me, 'vacancy.status_change', 'Vacancy', v.id, { label: v.vacancyNo, old: { status: old }, new: { status: 'Filled', joined: joinedCount } });
      }
      await this.notify.notify(m, [v.createdById], 'joining.approved', `${app.applicationNo} joined ${v.positionTitle} (${v.vacancyNo})`, `/joined`);
      return { joining: j, duplicate: false };
    });
  }

  /** A selected candidate turned down at joining stays listed as Rejected (owner, 2026-11-04); the final decision is untouched. */
  async reject(id: string, remarks: string, me: AuthUser) {
    return this.move(id, 'Pending', 'Rejected', remarks, 'joining.reject', me);
  }

  /** Undoes a rejection made by mistake: back to Joining Pending, while the final decision is still Selected. */
  async reopen(id: string, remarks: string, me: AuthUser) {
    return this.move(id, 'Rejected', 'Pending', remarks, 'joining.reopen', me);
  }

  private async move(id: string, from: JoiningRecord['status'], to: JoiningRecord['status'], remarks: string, action: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const j = await m.findOne(JoiningRecord, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!j) throw new NotFoundException();
      if (j.status === to) return j;
      if (j.status !== from) throw new ConflictException(`Joining record is ${j.status}.`);
      const app = await m.findOneOrFail(Application, { where: { id: j.applicationId } });
      if (to === 'Pending' && app.finalDecision !== 'Selected') throw new ConflictException('The final decision is no longer Selected, so the candidate cannot return to Joining Pending.');
      const old = { status: j.status, remarks: j.remarks };
      Object.assign(j, { status: to, remarks });
      await m.save(j);
      await this.audit.log(m, me, action, 'Application', j.applicationId, { label: app.applicationNo, old, new: { status: to, remarks } });

      // Rejecting a join below the headcount reopens the vacancy (owner, 2026-11-09): stale 'Filled'
      // left Mail Scan and CV upload refusing new CVs even when no one actually joined any more.
      if (from === 'Approved' && to !== 'Approved') {
        const v = await m.findOneOrFail(Vacancy, { where: { id: app.vacancyId }, lock: { mode: 'pessimistic_write' } });
        await this.adjustManpower(m, v, -1, me);
        if (v.status === 'Filled') {
          const joined = await m.createQueryBuilder(JoiningRecord, 'jr').innerJoin(Application, 'a', 'a.id = jr.applicationId')
            .where(`a.vacancyId = :v AND jr.status = 'Approved'`, { v: v.id }).getCount();
          if (joined < v.headcount) {
            v.status = 'Screening';
            await m.save(v);
            await this.audit.log(m, me, 'vacancy.status_change', 'Vacancy', v.id, { label: v.vacancyNo, old: { status: 'Filled' }, new: { status: 'Screening', joined } });
          }
        }
      }
      return j;
    });
  }

  /**
   * Shifts the matching (company, department, position) quota row's `presentManpower` by `delta`
   * (owner, 2026-11-10: dept-total rows are gone — the department's present manpower is derived as the sum
   * of its designation rows, so no separate write is needed).
   * Rows that do not exist are left alone — an admin must create the baseline row first for auto-tracking to kick in.
   * Audits every change so figures can be traced back to the joining that drove them.
   */
  private async adjustManpower(m: EntityManager, v: Vacancy, delta: number, me: AuthUser) {
    const rows: { id: string; before: number | null }[] = await m.query(
      `SELECT id, "presentManpower" AS before FROM manpower_quotas
        WHERE "departmentId" = $1 AND "positionId" = $2
        FOR UPDATE`,
      [v.departmentId, v.positionId]);
    for (const r of rows) {
      const before = r.before ?? 0;
      const after = Math.max(0, before + delta);
      if (after === r.before) continue;
      await m.update(ManpowerQuota, r.id, { presentManpower: after, updatedById: me.id });
      await this.audit.log(m, me, 'quota.auto_update', 'ManpowerQuota', r.id, {
        label: 'Designation',
        old: { presentManpower: r.before },
        new: { presentManpower: after, reason: delta > 0 ? 'joining.approved' : 'joining.reverted' },
      });
    }
  }
}
