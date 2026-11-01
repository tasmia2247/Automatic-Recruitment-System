import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { createHash } from 'crypto';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { AuthUser } from '../common/auth';
import { paged, skipTake } from '../common/pagination';
import { P } from '../common/permissions';
import { AuditService, diff, IdService, normalizeEmail, normalizePhone, NotificationService, StorageService, validateUpload } from '../common/services';
import {
  Application, AuditEvent, Candidate, CandidateDocument, CandidateRemark, CandidateStage, EmailEvent, EvaluationMark,
  ExtractionRun, IntakeMessage, JobPost, JoiningRecord, ProcessingJob, ScreeningCriteriaSet, ScreeningRun, Vacancy,
} from '../database/entities';
import { JobsService } from '../processing/jobs.service';
import { screen } from '../screening/screening.engine';
import { CORE_FIELDS, cvToText, EXTRACTED_FIELDS, EXTRACTOR_VERSION, extractFromText } from './cv-extractor';

export interface UploadResult { fileName: string; ok: boolean; applicationNo?: string; candidateNo?: string; applicationId?: string; error?: string }

export const EDITABLE_APP_FIELDS = [
  'education', 'degree', 'institution', 'cgpaRaw', 'cgpa', 'totalExperienceYears', 'relevantExperienceYears', 'workplace',
  'skills', 'expectedSalary', 'age',
] as const;

const RESULT_ORDER = `CASE a."screeningResult" WHEN 'Pass' THEN 0 WHEN 'Review Required' THEN 1 WHEN 'Fail' THEN 2 ELSE 3 END`;

@Injectable()
export class CandidatesService implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly ids: IdService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('EXTRACTION', (job) => this.processExtraction(job.refId));
    this.jobs.register('SCREENING', (job) => this.processScreening(job.refId, (job.payload?.runById as string) ?? null));
  }

  // ------------------------------------------------------------------ intake

  /** Manual multi-file upload; each file succeeds or fails on its own (SRS 9.3). */
  async uploadManual(vacancyId: string, files: Express.Multer.File[], me: AuthUser): Promise<UploadResult[]> {
    if (!files?.length) throw new BadRequestException('Select at least one CV file.');
    const vacancy = await this.ds.getRepository(Vacancy).findOne({ where: { id: vacancyId } });
    if (!vacancy) throw new NotFoundException('Vacancy not found.');
    if (['Closed', 'Filled'].includes(vacancy.status)) throw new ConflictException(`Vacancy is ${vacancy.status}; CVs can no longer be added.`);
    const results: UploadResult[] = [];
    for (const f of files) {
      const err = validateUpload(f);
      if (err) { results.push({ fileName: f.originalname, ok: false, error: err }); continue; }
      try {
        const app = await this.ds.transaction((m) => this.createApplicationFromFile(m, vacancy, f.buffer, f.originalname, f.mimetype, 'MANUAL', me));
        results.push({ fileName: f.originalname, ok: true, applicationId: app.id, applicationNo: app.applicationNo, candidateNo: app.candidate.candidateNo });
      } catch (e: any) {
        results.push({ fileName: f.originalname, ok: false, error: e?.response?.message ?? e.message });
      }
    }
    const ok = results.filter((r) => r.ok).length;
    await this.audit.log(this.ds.manager, me, 'cv.upload_batch', 'Vacancy', vacancyId, { label: vacancy.vacancyNo, new: { files: files.length, accepted: ok, rejected: files.length - ok } });
    return results;
  }

  /** Creates candidate + application + document and queues extraction. Same file twice for a vacancy is rejected. */
  async createApplicationFromFile(m: EntityManager, vacancy: Vacancy, buffer: Buffer, fileName: string, mimeType: string, source: 'MANUAL' | 'EMAIL', me: AuthUser | null, sender?: string | null) {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const dup = await m.createQueryBuilder(CandidateDocument, 'd').innerJoin(Application, 'a', 'a.id = d.applicationId')
      .where('d.sha256 = :h AND a.vacancyId = :v', { h: sha256, v: vacancy.id }).select('a.applicationNo', 'no').getRawOne();
    if (dup) throw new ConflictException(`This exact file was already received for this vacancy (${dup.no}).`);

    const jobPost = await m.findOne(JobPost, { where: { vacancyId: vacancy.id, status: 'Published' }, order: { createdAt: 'DESC' } })
      ?? await m.findOne(JobPost, { where: { vacancyId: vacancy.id }, order: { createdAt: 'DESC' } });
    const senderEmail = normalizeEmail(sender);
    const candidate = await m.save(Candidate, m.create(Candidate, {
      candidateNo: await this.ids.next(m, 'CAND'), email: senderEmail, emailNormalized: senderEmail,
    }));
    const stored = this.storage.save(buffer, fileName, mimeType, 'cvs');
    const app = await m.save(Application, m.create(Application, {
      applicationNo: await this.ids.next(m, 'APP'), candidateId: candidate.id, vacancyId: vacancy.id, jobPostId: jobPost?.id ?? null,
      source, receivedAt: new Date(), processingStatus: 'Queued',
    }));
    await m.insert(CandidateDocument, {
      applicationId: app.id, candidateId: candidate.id, ...stored, source, uploadedById: me?.id ?? null,
    });
    await this.jobs.enqueue(m, 'EXTRACTION', app.id, app.applicationNo);
    if (vacancy.status === 'Open' || vacancy.status === 'Posting') await m.update(Vacancy, vacancy.id, { status: 'Screening' });
    app.candidate = candidate;
    return app;
  }

  // ------------------------------------------------------------------ background handlers

  /** Idempotent: re-running updates the same application; never creates a second one (AC-26). */
  async processExtraction(applicationId: string) {
    const app = await this.ds.getRepository(Application).findOne({ where: { id: applicationId }, relations: { candidate: true } });
    if (!app) throw new Error('Application no longer exists.');
    const doc = await this.ds.getRepository(CandidateDocument).findOne({ where: { applicationId }, order: { createdAt: 'DESC' } });
    if (!doc) throw new Error('No CV document stored for this application.');
    await this.ds.getRepository(Application).update(applicationId, { processingStatus: 'Processing', processingError: null });
    const run = await this.ds.getRepository(ExtractionRun).save({ applicationId, documentId: doc.id, status: 'Processing', processorVersion: EXTRACTOR_VERSION });

    let text: string;
    try {
      text = await cvToText(this.storage.read(doc.storageKey), doc.originalName);
      if (!text.trim()) throw new Error('No readable text found (the file may be a scanned image). Please review manually.');
    } catch (e: any) {
      await this.ds.transaction(async (m) => {
        await m.update(ExtractionRun, run.id, { status: 'Failed', error: e.message, completedAt: new Date() });
        await m.update(Application, applicationId, { processingStatus: 'Failed', processingError: e.message, extractionStatus: 'Failed' });
      });
      throw e;
    }

    const ex = extractFromText(text);
    const missing = EXTRACTED_FIELDS.filter((f) => ex[f] === null);
    const partial = CORE_FIELDS.some((f) => ex[f] === null);
    await this.ds.transaction(async (m) => {
      await m.update(ExtractionRun, run.id, { status: partial ? 'Partial' : 'Completed', extracted: ex as any, missingFields: missing, completedAt: new Date() });
      const fresh = await m.findOneOrFail(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      // Never overwrite values a human has corrected.
      const patch: Partial<Application> = {};
      for (const f of ['education', 'degree', 'institution', 'cgpaRaw', 'cgpa', 'totalExperienceYears', 'workplace', 'skills', 'expectedSalary', 'age'] as const) {
        if (!fresh.correctedFields.includes(f)) (patch as any)[f] = ex[f];
      }
      patch.processingStatus = partial ? 'Partial' : 'Completed';
      patch.extractionStatus = partial ? 'Review Required' : 'Success';
      await m.update(Application, applicationId, patch);
      const cand = app.candidate;
      const cpatch: Partial<Candidate> = {};
      if (!cand.name && ex.name) cpatch.name = ex.name;
      if (!cand.email && ex.email) { cpatch.email = ex.email; cpatch.emailNormalized = normalizeEmail(ex.email); }
      if (!cand.phone && ex.phone) { cpatch.phone = ex.phone; cpatch.phoneNormalized = normalizePhone(ex.phone); }
      if (Object.keys(cpatch).length) await m.update(Candidate, cand.id, cpatch);
      await this.detectDuplicate(m, applicationId, cand.id, doc.sha256, { ...cand, ...cpatch });
      await this.jobs.enqueue(m, 'SCREENING', applicationId, app.applicationNo);
    });
    return partial ? { status: 'Partial' as const, note: `Missing: ${missing.join(', ')}` } : undefined;
  }

  /** Flags possible duplicates for human review; never merges automatically (SRS 9.4). */
  private async detectDuplicate(m: EntityManager, applicationId: string, candidateId: string, sha256: string, c: Partial<Candidate>) {
    const app = await m.findOneOrFail(Application, { where: { id: applicationId } });
    if (app.duplicateReview !== 'NONE') return;
    const evidence: string[] = [];
    let suspect: string | null = null;
    const qb = m.createQueryBuilder(Candidate, 'c').where('c.id <> :id AND c.mergedIntoId IS NULL', { id: candidateId });
    if (c.emailNormalized) {
      const hit = await qb.clone().andWhere('c.emailNormalized = :e', { e: c.emailNormalized }).getOne();
      if (hit) { suspect = hit.id; evidence.push(`same email as ${hit.candidateNo}`); }
    }
    if (c.phoneNormalized) {
      const hit = await qb.clone().andWhere('c.phoneNormalized = :p', { p: c.phoneNormalized }).getOne();
      if (hit) { suspect ??= hit.id; evidence.push(`same phone as ${hit.candidateNo}`); }
    }
    const fileHit = await m.createQueryBuilder(CandidateDocument, 'd').innerJoin(Candidate, 'c', 'c.id = d.candidateId')
      .where('d.sha256 = :h AND d.candidateId <> :id', { h: sha256, id: candidateId }).select(['c.id AS id', 'c.candidateNo AS no']).getRawOne();
    if (fileHit) { suspect ??= fileHit.id; evidence.push(`identical CV file as ${fileHit.no}`); }
    if (suspect) {
      await m.update(Application, applicationId, { duplicateReview: 'PENDING', suspectedDuplicateCandidateId: suspect, duplicateEvidence: evidence.join('; ') });
    }
  }

  async processScreening(applicationId: string, runById: string | null) {
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new Error('Application no longer exists.');
      if (!app.jobPostId) {
        const jp = await m.findOne(JobPost, { where: { vacancyId: app.vacancyId }, order: { createdAt: 'DESC' } });
        if (!jp) return { status: 'Partial' as const, note: 'No job post / criteria for this vacancy yet; screening skipped.' };
        app.jobPostId = jp.id;
        await m.update(Application, app.id, { jobPostId: jp.id });
      }
      const jp = await m.findOneOrFail(JobPost, { where: { id: app.jobPostId! } });
      if (!jp.currentCriteriaVersion) return { status: 'Partial' as const, note: 'Job post has no screening criteria yet; screening skipped.' };
      const set = await m.findOneOrFail(ScreeningCriteriaSet, { where: { jobPostId: jp.id, version: jp.currentCriteriaVersion } });
      const input = {
        degree: app.degree, education: app.education, institution: app.institution, cgpa: app.cgpa,
        totalExperienceYears: app.totalExperienceYears, relevantExperienceYears: app.relevantExperienceYears,
        skills: app.skills, expectedSalary: app.expectedSalary, age: app.age,
      };
      const { overall, results } = screen(set.criteria.sort((a, b) => a.sortOrder - b.sortOrder), input);
      const run = await m.save(ScreeningRun, m.create(ScreeningRun, {
        applicationId, criteriaSetId: set.id, criteriaVersion: set.version, overallResult: overall, results, inputs: input, runById,
      }));
      await m.update(Application, applicationId, { screeningResult: overall, latestScreeningRunId: run.id });
      return undefined;
    });
  }

  /** Re-screen all applications of a vacancy against the current criteria version; old runs are kept. */
  async rescreenVacancy(vacancyId: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const apps = await m.find(Application, { where: { vacancyId, processingStatus: In(['Completed', 'Partial']) } });
      for (const a of apps) await this.jobs.enqueue(m, 'SCREENING', a.id, a.applicationNo, { runById: me.id });
      await this.audit.log(m, me, 'screening.rerun', 'Vacancy', vacancyId, { new: { applications: apps.length } });
      return { queued: apps.length };
    });
  }

  // ------------------------------------------------------------------ queries

  async listForVacancy(vacancyId: string, q: { page?: number; pageSize?: number; q?: string; result?: string; sort?: string; dir?: 'ASC' | 'DESC'; shortlisted?: string; finalDecision?: string; duplicate?: string }) {
    const qb = this.ds.getRepository(Application).createQueryBuilder('a').innerJoinAndSelect('a.candidate', 'c')
      .where('a.vacancyId = :v', { v: vacancyId });
    if (q.result) qb.andWhere('a.screeningResult = :r', { r: q.result });
    if (q.shortlisted === 'true') qb.andWhere('a.shortlisted = true');
    if (q.finalDecision) qb.andWhere('a.finalDecision = :fd', { fd: q.finalDecision });
    if (q.duplicate === 'true') qb.andWhere(`a.duplicateReview = 'PENDING'`);
    if (q.q) qb.andWhere(new Brackets((w) => w.where('c.name ILIKE :q').orWhere('c.email ILIKE :q').orWhere('a.applicationNo ILIKE :q').orWhere('c.candidateNo ILIKE :q').orWhere('a.institution ILIKE :q').orWhere('a.degree ILIKE :q')), { q: `%${q.q}%` });
    const sortable: Record<string, string> = { cgpa: 'a.cgpa', experience: 'a.totalExperienceYears', name: 'c.name', institution: 'a.institution', degree: 'a.degree', received: 'a.receivedAt' };
    if (q.sort && sortable[q.sort]) qb.orderBy(sortable[q.sort], q.dir === 'ASC' ? 'ASC' : 'DESC', 'NULLS LAST');
    else qb.orderBy(RESULT_ORDER, 'ASC').addOrderBy('a.cgpa', 'DESC', 'NULLS LAST');
    const { skip, take } = skipTake(q);
    // offset/limit (not skip/take): only many-to-one joins here, and skip/take cannot order by the CASE expression.
    const [items, total] = await qb.offset(skip).limit(take).getManyAndCount();
    const counts = await this.ds.query(
      `SELECT coalesce("screeningResult", 'Not screened') AS result, count(*)::int AS n FROM applications WHERE "vacancyId" = $1 GROUP BY 1`, [vacancyId]);
    const runs = items.length ? await this.ds.getRepository(ScreeningRun).find({ where: { id: In(items.map((i) => i.latestScreeningRunId).filter(Boolean) as string[]) } }) : [];
    return {
      ...paged(items.map((a) => ({ ...a, screeningReasons: runs.find((r) => r.id === a.latestScreeningRunId)?.results.filter((r) => r.outcome !== 'Pass').map((r) => r.reason) ?? [] })), total, q as any),
      counts,
    };
  }

  async detail(applicationId: string) {
    const app = await this.ds.getRepository(Application).findOne({
      where: { id: applicationId }, relations: { candidate: true, vacancy: { department: true, company: true }, jobPost: true },
    });
    if (!app) throw new NotFoundException('Application not found.');
    const [documents, extractionRuns, screeningRuns, remarks, stages, marks, emails, joining, otherApps, history, suspect] = await Promise.all([
      this.ds.getRepository(CandidateDocument).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(ExtractionRun).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(ScreeningRun).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(CandidateRemark).find({ where: { applicationId }, relations: { author: true }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(CandidateStage).find({ where: { applicationId } }),
      this.ds.getRepository(EvaluationMark).find({ where: { applicationId }, relations: { evaluator: true } }),
      this.ds.getRepository(EmailEvent).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(JoiningRecord).findOne({ where: { applicationId } }),
      this.ds.getRepository(Application).find({ where: { candidateId: app.candidateId }, relations: { vacancy: true } }),
      this.ds.getRepository(AuditEvent).createQueryBuilder('e')
        .where('(e.entityType = :t AND e.entityId = :id) OR (e.entityType = :ct AND e.entityId = :cid)', { t: 'Application', id: applicationId, ct: 'Candidate', cid: app.candidateId })
        .orderBy('e.createdAt', 'DESC').take(100).getMany(),
      app.suspectedDuplicateCandidateId ? this.ds.getRepository(Candidate).findOne({ where: { id: app.suspectedDuplicateCandidateId }, relations: { applications: { vacancy: true } } }) : null,
    ]);
    return {
      ...app,
      documents, extractionRuns, screeningRuns, remarks: remarks.map((r) => ({ ...r, author: { name: r.author.name } })),
      stages, marks: marks.map((mk) => ({ ...mk, evaluator: { name: mk.evaluator.name } })), emails: emails.map(({ body, ...e }) => e), joining,
      otherApplications: otherApps.filter((a) => a.id !== applicationId).map((a) => ({ id: a.id, applicationNo: a.applicationNo, vacancyNo: a.vacancy.vacancyNo, positionTitle: a.vacancy.positionTitle, finalDecision: a.finalDecision })),
      suspectedDuplicate: suspect ? { id: suspect.id, candidateNo: suspect.candidateNo, name: suspect.name, email: suspect.email, phone: suspect.phone, applications: suspect.applications.map((a) => ({ applicationNo: a.applicationNo, vacancyNo: a.vacancy.vacancyNo })) } : null,
      history,
    };
  }

  async document(documentId: string) {
    const doc = await this.ds.getRepository(CandidateDocument).findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException();
    return { doc, buffer: this.storage.read(doc.storageKey) };
  }

  // ------------------------------------------------------------------ corrections & review

  /** Human correction of extracted data; prior values are audited and the field is protected from re-extraction. */
  async correct(applicationId: string, dto: Record<string, any>, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException();
      app.candidate = await m.findOneOrFail(Candidate, { where: { id: app.candidateId } });
      const { name, email, phone, ...appFields } = dto;
      const candPatch: Partial<Candidate> = {};
      if (name !== undefined) candPatch.name = name || null;
      if (email !== undefined) { candPatch.email = email || null; candPatch.emailNormalized = normalizeEmail(email); }
      if (phone !== undefined) { candPatch.phone = phone || null; candPatch.phoneNormalized = normalizePhone(phone); }
      const cd = diff(app.candidate, { ...app.candidate, ...candPatch }, ['name', 'email', 'phone']);
      const ad = diff(app, { ...app, ...appFields }, Object.keys(appFields));
      if (!cd.changed.length && !ad.changed.length) return app;
      if (cd.changed.length) {
        await m.update(Candidate, app.candidateId, candPatch);
        await this.audit.log(m, me, 'candidate.correct', 'Candidate', app.candidateId, { label: app.candidate.candidateNo, old: cd.old, new: cd.new });
      }
      if (ad.changed.length) {
        const corrected = [...new Set([...app.correctedFields, ...ad.changed])];
        await m.update(Application, applicationId, { ...appFields, correctedFields: corrected });
        await this.audit.log(m, me, 'application.correct', 'Application', applicationId, { label: app.applicationNo, old: ad.old, new: ad.new });
        await this.jobs.enqueue(m, 'SCREENING', applicationId, app.applicationNo, { runById: me.id });
      }
      return m.findOne(Application, { where: { id: applicationId }, relations: { candidate: true } });
    });
  }

  async addRemark(applicationId: string, text: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId } });
      if (!app) throw new NotFoundException();
      const r = await m.save(CandidateRemark, m.create(CandidateRemark, { applicationId, candidateId: app.candidateId, text, authorId: me.id }));
      await this.audit.log(m, me, 'application.remark', 'Application', applicationId, { label: app.applicationNo, new: { text } });
      return r;
    });
  }

  async resolveDuplicate(applicationId: string, action: 'MERGE' | 'SEPARATE', me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException();
      if (app.duplicateReview !== 'PENDING' || !app.suspectedDuplicateCandidateId) throw new ConflictException('This application has no pending duplicate review.');
      const fromCandidate = app.candidateId;
      if (action === 'MERGE') {
        const target = app.suspectedDuplicateCandidateId;
        if (await m.exists(Application, { where: { candidateId: target, vacancyId: app.vacancyId } })) {
          throw new ConflictException('The existing candidate already has an application for this vacancy. Reject this duplicate application instead of merging.');
        }
        await m.update(Application, applicationId, { candidateId: target, duplicateReview: 'MERGED' });
        await m.update(CandidateDocument, { applicationId }, { candidateId: target });
        await m.update(CandidateRemark, { applicationId }, { candidateId: target });
        const remaining = await m.count(Application, { where: { candidateId: fromCandidate } });
        if (!remaining) await m.update(Candidate, fromCandidate, { mergedIntoId: target });
      } else {
        await m.update(Application, applicationId, { duplicateReview: 'SEPARATE' });
      }
      await this.audit.log(m, me, action === 'MERGE' ? 'candidate.merge' : 'candidate.keep_separate', 'Application', applicationId, {
        label: app.applicationNo, old: { candidateId: fromCandidate }, new: { candidateId: action === 'MERGE' ? app.suspectedDuplicateCandidateId : fromCandidate, evidence: app.duplicateEvidence },
      });
      return { ok: true };
    });
  }

  /** HR shortlist decision; the automated screening result is never changed (SRS 10.6 / AC-18). */
  async shortlist(vacancyId: string, applicationIds: string[], shortlisted: boolean, reason: string | undefined, me: AuthUser) {
    const results: { applicationId: string; applicationNo?: string; ok: boolean; error?: string }[] = [];
    for (const id of applicationIds) {
      try {
        await this.ds.transaction(async (m) => {
          const app = await m.findOne(Application, { where: { id, vacancyId }, lock: { mode: 'pessimistic_write' } });
          if (!app) throw new NotFoundException('Application not found for this vacancy.');
          results.push({ applicationId: id, applicationNo: app.applicationNo, ok: false });
          if (app.shortlisted === shortlisted) { results[results.length - 1].ok = true; return; }
          if (shortlisted && app.screeningResult !== 'Pass') {
            if (!me.permissions.has(P.SHORTLIST_OVERRIDE)) throw new ForbiddenException(`Screening result is "${app.screeningResult ?? 'Not screened'}"; you need override permission.`);
            if (app.screeningResult === 'Fail' && !reason?.trim()) throw new BadRequestException('An override reason is required to shortlist a candidate who failed a mandatory criterion.');
          }
          await m.update(Application, id, {
            shortlisted, shortlistReason: shortlisted ? reason?.trim() || null : null, shortlistedById: me.id, shortlistedAt: new Date(),
          });
          await this.audit.log(m, me, shortlisted ? (app.screeningResult === 'Pass' ? 'selection.shortlist' : 'selection.shortlist_override') : 'selection.unshortlist', 'Application', id, {
            label: app.applicationNo, old: { shortlisted: app.shortlisted }, new: { shortlisted, screeningResult: app.screeningResult, reason },
          });
          results[results.length - 1].ok = true;
        });
      } catch (e: any) {
        const r = results.find((x) => x.applicationId === id);
        const msg = e?.response?.message ?? e.message;
        if (r) { r.ok = false; r.error = msg; } else results.push({ applicationId: id, ok: false, error: msg });
      }
    }
    return results;
  }

  // ------------------------------------------------------------------ unmatched email intake

  async unmatched() {
    return this.ds.getRepository(IntakeMessage).find({ where: { status: In(['Unmatched', 'Failed']) }, order: { receivedAt: 'DESC' } });
  }

  async assignUnmatched(messageId: string, vacancyId: string, me: AuthUser) {
    const msg = await this.ds.getRepository(IntakeMessage).findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException();
    if (msg.status === 'Assigned') return msg;
    const vacancy = await this.ds.getRepository(Vacancy).findOneOrFail({ where: { id: vacancyId } });
    for (const att of msg.attachments) {
      if (att.applicationId) continue;
      try {
        const app = await this.ds.transaction((m) => this.createApplicationFromFile(m, vacancy, this.storage.read(att.storageKey), att.originalName, att.mimeType, 'EMAIL', me, msg.sender));
        att.applicationId = app.id;
        delete att.error;
      } catch (e: any) {
        att.error = e?.response?.message ?? e.message;
      }
    }
    msg.vacancyId = vacancyId;
    msg.status = msg.attachments.every((a) => a.applicationId) ? 'Assigned' : 'Failed';
    await this.ds.getRepository(IntakeMessage).save(msg);
    await this.audit.log(this.ds.manager, me, 'intake.assign', 'IntakeMessage', msg.id, { label: msg.subject?.slice(0, 60), new: { vacancy: vacancy.vacancyNo } });
    return msg;
  }

  // ------------------------------------------------------------------ Excel export (SRS 11)

  async exportVacancy(vacancyId: string, result: string | undefined, me: AuthUser) {
    const vacancy = await this.ds.getRepository(Vacancy).findOne({ where: { id: vacancyId } });
    if (!vacancy) throw new NotFoundException();
    const qb = this.ds.getRepository(Application).createQueryBuilder('a').innerJoinAndSelect('a.candidate', 'c')
      .where('a.vacancyId = :v', { v: vacancyId }).orderBy(RESULT_ORDER, 'ASC').addOrderBy('a.applicationNo', 'ASC');
    if (result) qb.andWhere('a.screeningResult = :r', { r: result });
    const apps = await qb.getMany();
    const runs = apps.length ? await this.ds.getRepository(ScreeningRun).find({ where: { id: In(apps.map((a) => a.latestScreeningRunId).filter(Boolean) as string[]) } }) : [];
    const remarks = apps.length ? await this.ds.getRepository(CandidateRemark).find({ where: { applicationId: In(apps.map((a) => a.id)) }, order: { createdAt: 'ASC' } }) : [];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ananta ARS';
    const ws = wb.addWorksheet('Candidates');
    ws.columns = [
      { header: 'Candidate ID', key: 'candidateNo', width: 14 }, { header: 'Application ID', key: 'applicationNo', width: 18 },
      { header: 'Candidate Name', key: 'name', width: 26 }, { header: 'Education', key: 'education', width: 30 },
      { header: 'Institution', key: 'institution', width: 28 }, { header: 'CGPA', key: 'cgpa', width: 8 },
      { header: 'Work Experience (years)', key: 'exp', width: 12 }, { header: 'Workplace', key: 'workplace', width: 24 },
      { header: 'Email', key: 'email', width: 28 }, { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Applied Position', key: 'position', width: 22 }, { header: 'Screening Status', key: 'result', width: 16 },
      { header: 'Screening Reasons', key: 'reasons', width: 50 }, { header: 'Remarks', key: 'remarks', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    const REVIEW = 'Needs review';
    for (const a of apps) {
      const run = runs.find((r) => r.id === a.latestScreeningRunId);
      ws.addRow({
        candidateNo: a.candidate.candidateNo, applicationNo: a.applicationNo, name: a.candidate.name ?? REVIEW,
        education: a.education ?? a.degree ?? '', institution: a.institution ?? '', cgpa: a.cgpa ?? (a.cgpaRaw ? a.cgpaRaw : ''),
        exp: a.totalExperienceYears ?? '', workplace: a.workplace ?? '', email: a.candidate.email ?? REVIEW, phone: a.candidate.phone ?? REVIEW,
        position: vacancy.positionTitle, result: a.screeningResult ?? 'Not screened',
        reasons: run ? run.results.map((r) => r.reason).join('\n') : '',
        remarks: remarks.filter((r) => r.applicationId === a.id).map((r) => r.text).join('\n'),
      });
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await this.audit.log(this.ds.manager, me, 'report.candidate_export', 'Vacancy', vacancyId, { label: vacancy.vacancyNo, new: { rows: apps.length, filter: result ?? 'all' } });
    return { fileName: `${vacancy.vacancyNo}_candidates.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  async pendingJobsFor(applicationId: string) {
    return this.ds.getRepository(ProcessingJob).find({ where: { refId: applicationId }, order: { createdAt: 'DESC' } });
  }
}
