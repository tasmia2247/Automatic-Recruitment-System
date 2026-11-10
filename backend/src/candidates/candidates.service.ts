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
  Application, Candidate, CandidateDocument, CandidateRemark, CandidateStage, EvaluationMark,
  ExtractionRun, IntakeMessage, JobPost, JoiningRecord, ProcessingJob, Requisition, ScreeningRun, Vacancy,
} from '../database/entities';
import { JobsService } from '../processing/jobs.service';
import { screenRequirements } from '../screening/screening.engine';
import { CORE_FIELDS, cvToText, EXTRACTED_FIELDS, EXTRACTOR_VERSION, extractFromText, readCv } from './cv-extractor';

export interface UploadResult { fileName: string; ok: boolean; applicationNo?: string; candidateNo?: string; applicationId?: string; error?: string }

export const EDITABLE_APP_FIELDS = [
  'education', 'degree', 'specialization', 'institution', 'cgpaRaw', 'cgpa', 'totalExperienceYears', 'relevantExperienceYears', 'lastPosition', 'workplace',
  'skills', 'address', 'certifications', 'previousJobs', 'expectedSalary', 'age',
] as const;

/**
 * The CV Bank Excel: HR's "New CV data bank" columns, the extra CV fields the owner asked for (2026-11-04), and the screening
 * data with the rest of the candidate export (owner, 2026-11-08: one sheet with both).
 */
const CV_DATA_COLUMNS = [
  { header: 'APPLICATION ID', key: 'applicationNo', width: 18 }, { header: 'CANDIDATE ID', key: 'candidateNo', width: 14 }, { header: 'EMAIL', key: 'email', width: 30 },
  { header: 'NAME OF THE APPLICANT', key: 'name', width: 34 }, { header: 'DATE OF RECEIVING CV', key: 'received', width: 16 },
  { header: 'LAST POSITION', key: 'lastPosition', width: 23 }, { header: 'LAST ORGANIZATION NAME', key: 'workplace', width: 25 },
  { header: 'TOTAL YEAR OF EXPERIENCE', key: 'experience', width: 16 }, { header: 'PRELIMINARY RECOMMENDED POSITION', key: 'position', width: 22 },
  { header: 'PRELIMINARY RECOMMENDED DEPARTMENT', key: 'department', width: 22 }, { header: 'PRELIMINARY RECOMMENDED FACTORY', key: 'factory', width: 20 },
  { header: 'MOBILE NO.', key: 'phone', width: 18 }, { header: 'SOURCE OF CV', key: 'source', width: 13 },
  { header: 'EDUCATIONAL STATUS', key: 'degree', width: 20 }, { header: 'EDUCATION SPECIALIZATION WITH REMARK (IF ANY)', key: 'specialization', width: 32 },
  { header: 'ADDRESS', key: 'address', width: 34 }, { header: 'SKILLS', key: 'skills', width: 34 },
  { header: 'PREVIOUS JOBS & DESIGNATIONS', key: 'previousJobs', width: 40 }, { header: 'CERTIFICATIONS', key: 'certifications', width: 32 },
  { header: 'EXPECTED SALARY', key: 'expectedSalary', width: 16 }, { header: 'AGE', key: 'age', width: 8 },
  { header: 'INSTITUTION', key: 'institution', width: 28 }, { header: 'CGPA', key: 'cgpa', width: 9 }, { header: 'ALL EDUCATION', key: 'education', width: 44 },
  { header: 'SCREENING RESULT', key: 'result', width: 16 }, { header: 'MATCH SCORE (%)', key: 'score', width: 12 },
  { header: 'SCREENING REASONS', key: 'reasons', width: 50 }, { header: 'SHORTLISTED', key: 'shortlisted', width: 12 },
  { header: 'FINAL DECISION', key: 'finalDecision', width: 14 }, { header: 'HR REMARKS', key: 'remarks', width: 40 },
];

const RESULT_ORDER =`CASE a."screeningResult" WHEN 'Pass' THEN 0 WHEN 'Review Required' THEN 1 WHEN 'Fail' THEN 2 ELSE 3 END`;
/** Ranking within a result group: the match score, then CGPA. */
const SCORE_ORDER = 'a.screeningScore';

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
    this.jobs.register('EXTRACTION', (job) => this.processExtraction(job.refId, (job.payload?.runById as string) ?? null));
    this.jobs.register('SCREENING', (job) => this.processScreening(job.refId, (job.payload?.runById as string) ?? null));
  }

  // ------------------------------------------------------------------ intake

  /** Manual multi-file upload; each file succeeds or fails on its own (SRS 9.3). */
  async uploadManual(vacancyId: string, files: Express.Multer.File[], me: AuthUser): Promise<UploadResult[]> {
    if (!files?.length) throw new BadRequestException('Select at least one CV file.');
    const vacancy = await this.ds.getRepository(Vacancy).findOne({ where: { id: vacancyId } });
    if (!vacancy) throw new NotFoundException('Vacancy not found.');
    // CV upload is allowed regardless of vacancy status (owner, 2026-11-09). HR may need to add CVs
    // even to a Filled or Closed vacancy — e.g. when Selected candidates do not join and the Waiting
    // pool has to be topped up, or to backfill records.
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
  async createApplicationFromFile(m: EntityManager, vacancy: Vacancy, buffer: Buffer, fileName: string, mimeType: string, source: 'MANUAL' | 'EMAIL', me: AuthUser | null, receivedAt = new Date()) {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const dup = await m.createQueryBuilder(CandidateDocument, 'd').innerJoin(Application, 'a', 'a.id = d.applicationId')
      .where('d.sha256 = :h AND a.vacancyId = :v', { h: sha256, v: vacancy.id }).select('a.applicationNo', 'no').getRawOne();
    if (dup) throw new ConflictException(`This exact file was already received for this vacancy (${dup.no}).`);

    const jobPost = await m.findOne(JobPost, { where: { vacancyId: vacancy.id, status: 'Published' }, order: { createdAt: 'DESC' } })
      ?? await m.findOne(JobPost, { where: { vacancyId: vacancy.id }, order: { createdAt: 'DESC' } });
    // The email comes from the CV: a mail's sender is often HR forwarding it or a job portal, not the candidate.
    const candidate = await m.save(Candidate, m.create(Candidate, { candidateNo: await this.ids.next(m, 'CAND') }));
    const stored = this.storage.save(buffer, fileName, mimeType, 'cvs');
    const app = await m.save(Application, m.create(Application, {
      applicationNo: await this.ids.next(m, 'APP'), candidateId: candidate.id, vacancyId: vacancy.id, jobPostId: jobPost?.id ?? null,
      source, receivedAt, processingStatus: 'Queued',
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

  /**
   * Idempotent: re-running updates the same application; never creates a second one (AC-26). A re-read ("Re-read CVs") runs the
   * same way: fields a person corrected are kept, every earlier extraction run stays, and screening runs again afterwards.
   */
  async processExtraction(applicationId: string, runById: string | null = null) {
    const app = await this.ds.getRepository(Application).findOne({ where: { id: applicationId }, relations: { candidate: true } });
    if (!app) throw new Error('Application no longer exists.');
    const doc = await this.ds.getRepository(CandidateDocument).findOne({ where: { applicationId }, order: { createdAt: 'DESC' } });
    if (!doc) throw new Error('No CV document stored for this application.');
    await this.ds.getRepository(Application).update(applicationId, { processingStatus: 'Processing', processingError: null });
    const run = await this.ds.getRepository(ExtractionRun).save({ applicationId, documentId: doc.id, status: 'Processing', processorVersion: EXTRACTOR_VERSION });

    // The text kept from an earlier reading, else the file (a new CV, or one that could not be read before).
    let text: string;
    let nameHint: string | null = null;
    const fromFile = !doc.textContent;
    try {
      if (doc.textContent) ({ text, nameHint } = { text: doc.textContent, nameHint: doc.nameHint });
      else if (doc.storageKey) ({ text, nameHint } = await readCv(this.storage.read(doc.storageKey), doc.originalName));
      else throw new Error('Neither the CV file nor its text is kept for this application; enter the data by hand.');
      if (!text.trim()) throw new Error('No readable text found (the file may be a scanned image). Please review manually.');
    } catch (e: any) {
      await this.ds.transaction(async (m) => {
        await m.update(ExtractionRun, run.id, { status: 'Failed', error: e.message, completedAt: new Date() });
        await m.update(Application, applicationId, { processingStatus: 'Failed', processingError: e.message, extractionStatus: 'Failed' });
      });
      throw e;
    }

    const ex = extractFromText(text, { nameHint });
    const missing = EXTRACTED_FIELDS.filter((f) => ex[f] === null);
    const partial = CORE_FIELDS.some((f) => ex[f] === null);
    await this.ds.transaction(async (m) => {
      // The worker runs several jobs at once (2026-11-09): saving a candidate's email / phone and the duplicate check run one at
      // a time, so two CVs of the same person read together still see each other.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('ars:candidate-duplicates'))`);
      await m.update(ExtractionRun, run.id, { status: partial ? 'Partial' : 'Completed', extracted: ex as any, missingFields: missing, completedAt: new Date() });
      const fresh = await m.findOneOrFail(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      // Never overwrite values a human has corrected.
      const patch: Partial<Application> = {};
      for (const f of ['education', 'degree', 'specialization', 'institution', 'cgpaRaw', 'cgpa', 'totalExperienceYears', 'lastPosition', 'workplace', 'skills', 'address', 'certifications', 'previousJobs', 'expectedSalary', 'age'] as const) {
        if (!fresh.correctedFields.includes(f)) (patch as any)[f] = ex[f];
      }
      patch.processingStatus = partial ? 'Partial' : 'Completed';
      patch.extractionStatus = partial ? 'Review Required' : 'Success';
      await m.update(Application, applicationId, patch);
      // Name, email and phone belong to the person. An empty one is filled; one read earlier from this CV is replaced by the new
      // reading, unless a person corrected it or the candidate also has other applications (merged), whose CVs may differ.
      const cand = app.candidate;
      const own = (await m.count(Application, { where: { candidateId: cand.id } })) === 1;
      const replace = (f: 'name' | 'email' | 'phone') => !!ex[f] && (!cand[f] || (own && !fresh.correctedFields.includes(f) && cand[f] !== ex[f]));
      const cpatch: Partial<Candidate> = {};
      if (replace('name')) cpatch.name = ex.name;
      if (replace('email')) { cpatch.email = ex.email; cpatch.emailNormalized = normalizeEmail(ex.email); }
      if (replace('phone')) { cpatch.phone = ex.phone; cpatch.phoneNormalized = normalizePhone(ex.phone); }
      if (Object.keys(cpatch).length) await m.update(Candidate, cand.id, cpatch);
      await this.detectDuplicate(m, applicationId, cand.id, doc.sha256, { ...cand, ...cpatch });
      await this.jobs.enqueue(m, 'SCREENING', applicationId, app.applicationNo, runById ? { runById } : undefined);
      // CV files are not kept (owner, 2026-11-08): the text replaces the file once it has been read.
      if (fromFile) await m.update(CandidateDocument, doc.id, { textContent: text, nameHint, storageKey: null, fileRemovedAt: new Date() });
    });
    if (fromFile && doc.storageKey) this.storage.remove(doc.storageKey);
    return partial ? { status: 'Partial' as const, note: `Missing: ${missing.join(', ')}` } : undefined;
  }

  /** Deletes the kept file of a CV that could not be read, once HR has entered its data by hand; name, size and hash stay. */
  private async removeUnreadFile(applicationId: string) {
    const doc = await this.ds.getRepository(CandidateDocument).findOne({ where: { applicationId }, order: { createdAt: 'DESC' } });
    if (!doc?.storageKey) return;
    await this.ds.getRepository(CandidateDocument).update(doc.id, { storageKey: null, fileRemovedAt: new Date() });
    this.storage.remove(doc.storageKey);
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

  /**
   * Screens against the requisition's "Specialization required" fields and Key Responsibilities (a Direct HR vacancy's own fields):
   * education, minimum years and other requirements must be met, and the keyword match score of Required Skills, Key
   * Responsibilities, education and experience must reach the pass mark (`screenRequirements`). The CV text and the (extracted
   * or corrected) fields are searched.
   */
  async processScreening(applicationId: string, runById: string | null) {
    const app = await this.ds.getRepository(Application).findOne({ where: { id: applicationId }, relations: { vacancy: { requisition: true } } });
    if (!app) throw new Error('Application no longer exists.');
    const req: Requisition | null = app.vacancy.requisition;
    const requirements = req ?? { ...app.vacancy, jobDescription: null };
    if (!screenRequirements(requirements, {})) {
      return { status: 'Partial' as const, note: req ? `Requisition ${req.reqNo} has no "Specialization required"; screening skipped.` : `Direct HR vacancy ${app.vacancy.vacancyNo} has no "Specialization required"; screening skipped.` };
    }
    // Read outside the transaction: PDF parsing is slow. An unreadable file still screens on the corrected fields.
    const doc = await this.ds.getRepository(CandidateDocument).findOne({ where: { applicationId }, order: { createdAt: 'DESC' } });
    const cvText = doc?.textContent ?? (doc?.storageKey ? await cvToText(this.storage.read(doc.storageKey), doc.originalName).catch(() => '') : '');
    return this.ds.transaction(async (m) => {
      const a = await m.findOneOrFail(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      const input = {
        degree: a.degree, education: a.education, specialization: a.specialization, institution: a.institution, cgpa: a.cgpa,
        totalExperienceYears: a.totalExperienceYears, relevantExperienceYears: a.relevantExperienceYears, lastPosition: a.lastPosition, workplace: a.workplace,
        skills: a.skills, certifications: a.certifications, previousJobs: a.previousJobs, expectedSalary: a.expectedSalary, age: a.age,
      };
      const searched = [cvText, ...Object.values(input).filter((v) => typeof v === 'string')].join('\n');
      const { overall, results, score, scoreParts } = screenRequirements(requirements, { ...input, cvText: searched })!;
      const run = await m.save(ScreeningRun, m.create(ScreeningRun, {
        applicationId, basis: req ? 'REQUISITION' : 'VACANCY', criteriaSetId: null, criteriaVersion: req ? req.version : app.vacancy.specializationVersion, overallResult: overall, results, inputs: input, runById,
        score, scoreParts,
      }));
      await m.update(Application, applicationId, { screeningResult: overall, screeningScore: score, latestScreeningRunId: run.id });
      return undefined;
    });
  }

  /**
   * Reads the stored CVs again with the current extractor (owner, 2026-11-08), then screens them again. One application, or every
   * application of a vacancy that has a CV. Corrected fields are kept; earlier extraction and screening runs stay.
   */
  async rereadCvs(scope: { vacancyId: string } | { applicationId: string }, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const where = 'vacancyId' in scope ? { vacancyId: scope.vacancyId } : { id: scope.applicationId };
      const apps = (await m.find(Application, { where })).filter((a) => a.processingStatus !== 'Unmatched');
      const withCv = apps.length ? new Set((await m.find(CandidateDocument, { where: { applicationId: In(apps.map((a) => a.id)) }, select: { applicationId: true, textContent: true, storageKey: true } })).filter((d) => d.textContent || d.storageKey).map((d) => d.applicationId)) : new Set<string>();
      const chosen = apps.filter((a) => withCv.has(a.id));
      for (const a of chosen) {
        await m.update(Application, a.id, { processingStatus: 'Queued' });
        await this.jobs.enqueue(m, 'EXTRACTION', a.id, a.applicationNo, { runById: me.id });
      }
      const [type, id] = 'vacancyId' in scope ? ['Vacancy', scope.vacancyId] : ['Application', scope.applicationId];
      await this.audit.log(m, me, 'cv.reread', type, id, { label: 'applicationId' in scope ? chosen[0]?.applicationNo : undefined, new: { applications: chosen.length, extractor: EXTRACTOR_VERSION } });
      return { queued: chosen.length };
    });
  }

  /** Re-screen all applications of a vacancy against the requisition's "Specialization required"; old runs are kept. */
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
    const sortable: Record<string, string> = { score: SCORE_ORDER, cgpa: 'a.cgpa', experience: 'a.totalExperienceYears', name: 'c.name', institution: 'a.institution', degree: 'a.degree', received: 'a.receivedAt' };
    if (q.sort && sortable[q.sort]) qb.orderBy(sortable[q.sort], q.dir === 'ASC' ? 'ASC' : 'DESC', 'NULLS LAST');
    else qb.orderBy(RESULT_ORDER, 'ASC').addOrderBy(SCORE_ORDER, 'DESC', 'NULLS LAST').addOrderBy('a.cgpa', 'DESC', 'NULLS LAST');
    const { skip, take } = skipTake(q);
    // offset/limit (not skip/take): only many-to-one joins here, and skip/take cannot order by the CASE expression.
    const [items, total] = await qb.offset(skip).limit(take).getManyAndCount();
    const counts = await this.ds.query(
      `SELECT coalesce("screeningResult", 'Not screened') AS result, count(*)::int AS n FROM applications WHERE "vacancyId" = $1 GROUP BY 1`, [vacancyId]);
    const runs = items.length ? await this.ds.getRepository(ScreeningRun).find({ where: { id: In(items.map((i) => i.latestScreeningRunId).filter(Boolean) as string[]) } }) : [];
    return {
      ...paged(items.map((a) => ({ ...a, screeningReasons: runs.find((r) => r.id === a.latestScreeningRunId)?.results.filter((r) => r.mandatory && r.outcome !== 'Pass').map((r) => r.reason) ?? [] })), total, q as any),
      counts,
    };
  }

  async detail(applicationId: string) {
    const app = await this.ds.getRepository(Application).findOne({
      where: { id: applicationId }, relations: { candidate: true, vacancy: { department: true, company: true }, jobPost: true },
    });
    if (!app) throw new NotFoundException('Application not found.');
    // Emails and activity are no longer part of the application page (owner, 2026-11-08); actions stay in the Audit Log.
    const [documents, extractionRuns, screeningRuns, remarks, stages, marks, joining, otherApps, suspect] = await Promise.all([
      this.ds.getRepository(CandidateDocument).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(ExtractionRun).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(ScreeningRun).find({ where: { applicationId }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(CandidateRemark).find({ where: { applicationId }, relations: { author: true }, order: { createdAt: 'DESC' } }),
      this.ds.getRepository(CandidateStage).find({ where: { applicationId } }),
      this.ds.getRepository(EvaluationMark).find({ where: { applicationId }, relations: { evaluator: true } }),
      this.ds.getRepository(JoiningRecord).findOne({ where: { applicationId } }),
      this.ds.getRepository(Application).find({ where: { candidateId: app.candidateId }, relations: { vacancy: true } }),
      app.suspectedDuplicateCandidateId ? this.ds.getRepository(Candidate).findOne({ where: { id: app.suspectedDuplicateCandidateId }, relations: { applications: { vacancy: true } } }) : null,
    ]);
    return {
      ...app,
      documents, extractionRuns, screeningRuns, remarks: remarks.map((r) => ({ ...r, author: { name: r.author.name } })),
      stages, marks: marks.map((mk) => ({ ...mk, evaluator: { name: mk.evaluator.name } })), joining,
      otherApplications: otherApps.filter((a) => a.id !== applicationId).map((a) => ({ id: a.id, applicationNo: a.applicationNo, vacancyNo: a.vacancy.vacancyNo, positionTitle: a.vacancy.positionTitle, finalDecision: a.finalDecision })),
      suspectedDuplicate: suspect ? { id: suspect.id, candidateNo: suspect.candidateNo, name: suspect.name, email: suspect.email, phone: suspect.phone, applications: suspect.applications.map((a) => ({ applicationNo: a.applicationNo, vacancyNo: a.vacancy.vacancyNo })) } : null,
    };
  }

  async document(documentId: string) {
    const doc = await this.ds.getRepository(CandidateDocument).findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException();
    if (!doc.storageKey) throw new NotFoundException('The original CV file is not kept; ARS keeps the text read from it (see the application).');
    return { doc, buffer: this.storage.read(doc.storageKey) };
  }

  // ------------------------------------------------------------------ corrections & review

  /** Human correction of extracted data; prior values are audited and the field is protected from re-extraction. */
  async correct(applicationId: string, dto: Record<string, any>, me: AuthUser) {
    let enteredForUnread = false;
    const res = await this.ds.transaction(async (m) => {
      const app = await m.findOne(Application, { where: { id: applicationId }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException();
      app.candidate = await m.findOneOrFail(Candidate, { where: { id: app.candidateId } });
      const { name, email, phone, ...sent } = dto;
      // Only the fields the request actually carries: the DTO lists every optional field, as undefined when not sent.
      const appFields = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== undefined));
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
        // A corrected name, email or phone is never replaced when the CV is read again.
        if (!ad.changed.length) await m.update(Application, applicationId, { correctedFields: [...new Set([...app.correctedFields, ...cd.changed])] });
        else app.correctedFields = [...new Set([...app.correctedFields, ...cd.changed])];
      }
      if (ad.changed.length) {
        const corrected = [...new Set([...app.correctedFields, ...ad.changed])];
        await m.update(Application, applicationId, { ...appFields, correctedFields: corrected });
        await this.audit.log(m, me, 'application.correct', 'Application', applicationId, { label: app.applicationNo, old: ad.old, new: ad.new });
        // Expected salary (typed on the Interview page, 2026-11-09) and age are not screened: changing only those re-runs nothing.
        if (ad.changed.some((f) => !['expectedSalary', 'age'].includes(f))) await this.jobs.enqueue(m, 'SCREENING', applicationId, app.applicationNo, { runById: me.id });
      }
      enteredForUnread = app.extractionStatus === 'Failed';
      return m.findOne(Application, { where: { id: applicationId }, relations: { candidate: true } });
    });
    // A CV that could not be read kept its file for HR; once HR has entered its data, the file goes too (owner, 2026-11-08).
    if (enteredForUnread) await this.removeUnreadFile(applicationId);
    return res;
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
    if (!msg.attachments.length) throw new ConflictException('This mail has no CV attachment to assign.');
    const vacancy = await this.ds.getRepository(Vacancy).findOneOrFail({ where: { id: vacancyId } });
    await this.assignAttachments(msg, vacancy, me);
    await this.audit.log(this.ds.manager, me, 'intake.assign', 'IntakeMessage', msg.id, { label: msg.subject?.slice(0, 60), new: { vacancy: vacancy.vacancyNo } });
    return msg;
  }

  /**
   * Permanently deletes an unmatched or failed mail and its stored attachment copies (owner, 2026-11-04). Applications already
   * created from it keep their own copy of the CV. Only the audit entry remains; scanning the same mail again brings it back.
   */
  async deleteUnmatched(messageId: string, me: AuthUser) {
    const msg = await this.ds.getRepository(IntakeMessage).findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Unmatched CV not found.');
    if (!['Unmatched', 'Failed'].includes(msg.status)) throw new ConflictException(`This mail is ${msg.status}; only unmatched or failed CVs can be deleted.`);
    await this.ds.transaction(async (m) => {
      await m.delete(IntakeMessage, msg.id);
      await this.audit.log(m, me, 'intake.delete', 'IntakeMessage', msg.id, {
        label: msg.subject?.slice(0, 60),
        old: { subject: msg.subject, sender: msg.sender, receivedAt: msg.receivedAt, status: msg.status, files: msg.attachments.map((a) => a.originalName) },
      });
    });
    for (const a of msg.attachments) this.storage.remove(a.storageKey);
    return { deleted: true };
  }

  /** Creates one application per attached CV; a file that fails keeps its error and can be assigned again. */
  async assignAttachments(msg: IntakeMessage, vacancy: Vacancy, me: AuthUser) {
    for (const att of msg.attachments) {
      if (att.applicationId) continue;
      try {
        const app = await this.ds.transaction((m) => this.createApplicationFromFile(m, vacancy, this.storage.read(att.storageKey), att.originalName, att.mimeType, 'EMAIL', me, msg.receivedAt ?? undefined));
        att.applicationId = app.id;
        delete att.error;
        // The application has its own copy, which is replaced by its text once read; the mail's copy is not kept.
        this.storage.remove(att.storageKey);
      } catch (e: any) {
        att.error = e?.response?.message ?? e.message;
      }
    }
    msg.vacancyId = vacancy.id;
    msg.status = msg.attachments.every((a) => a.applicationId) ? 'Assigned' : 'Failed';
    await this.ds.getRepository(IntakeMessage).save(msg);
  }

  // ------------------------------------------------------------------ Excel export (SRS 11)

  async exportVacancy(vacancyId: string, result: string | undefined, me: AuthUser) {
    const vacancy = await this.ds.getRepository(Vacancy).findOne({ where: { id: vacancyId } });
    if (!vacancy) throw new NotFoundException();
    const qb = this.ds.getRepository(Application).createQueryBuilder('a').innerJoinAndSelect('a.candidate', 'c')
      .where('a.vacancyId = :v', { v: vacancyId }).orderBy(RESULT_ORDER, 'ASC').addOrderBy(SCORE_ORDER, 'DESC', 'NULLS LAST').addOrderBy('a.applicationNo', 'ASC');
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
      { header: 'Applied Position', key: 'position', width: 22 }, { header: 'Screening Status', key: 'result', width: 16 }, { header: 'Match Score (%)', key: 'score', width: 12 },
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
        position: vacancy.positionTitle, result: a.screeningResult ?? 'Not screened', score: a.screeningScore ?? '',
        reasons: run ? run.results.map((r) => r.reason).join('\n') : '',
        remarks: remarks.filter((r) => r.applicationId === a.id).map((r) => r.text).join('\n'),
      });
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    await this.audit.log(this.ds.manager, me, 'report.candidate_export', 'Vacancy', vacancyId, { label: vacancy.vacancyNo, new: { rows: apps.length, filter: result ?? 'all' } });
    return { fileName: `${vacancy.vacancyNo}_candidates.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  /** The rows of a vacancy's CV data sheet, shared by the Excel download and the in-browser view. */
  async cvData(vacancyId: string) {
    const vacancy = await this.ds.getRepository(Vacancy).findOne({ where: { id: vacancyId }, relations: { department: true, company: true } });
    if (!vacancy) throw new NotFoundException();
    const apps = await this.ds.getRepository(Application).createQueryBuilder('a').innerJoinAndSelect('a.candidate', 'c')
      .where('a.vacancyId = :v', { v: vacancyId }).orderBy('a.receivedAt', 'ASC').addOrderBy('a.applicationNo', 'ASC').getMany();
    const REVIEW = 'Needs review';
    const runs = apps.length ? await this.ds.getRepository(ScreeningRun).find({ where: { id: In(apps.map((a) => a.latestScreeningRunId).filter(Boolean) as string[]) } }) : [];
    const remarks = apps.length ? await this.ds.getRepository(CandidateRemark).find({ where: { applicationId: In(apps.map((a) => a.id)) }, order: { createdAt: 'ASC' } }) : [];
    const rows = apps.map((a) => ({
      applicationId: a.id, applicationNo: a.applicationNo, candidateNo: a.candidate.candidateNo, email: a.candidate.email ?? REVIEW, name: a.candidate.name ?? REVIEW, received: a.receivedAt,
      lastPosition: a.lastPosition ?? '', workplace: a.workplace ?? '', experience: a.totalExperienceYears ?? '',
      position: vacancy.positionTitle, department: vacancy.department.name, factory: vacancy.company.code,
      phone: a.candidate.phone ?? REVIEW, source: a.source === 'EMAIL' ? 'EMAIL' : 'UPLOAD', degree: a.degree ?? '', specialization: a.specialization ?? '',
      address: a.address ?? '', skills: a.skills ?? '', previousJobs: a.previousJobs ?? '', certifications: a.certifications ?? '',
      expectedSalary: a.expectedSalary ?? '', age: a.age ?? '',
      institution: a.institution ?? '', cgpa: a.cgpa ?? a.cgpaRaw ?? '', education: a.education ?? '',
      result: a.screeningResult ?? 'Not screened', score: a.screeningScore ?? '',
      // What held the CV back (must-haves and the score), as in the candidate list.
      reasons: runs.find((r) => r.id === a.latestScreeningRunId)?.results.filter((r) => r.mandatory && r.outcome !== 'Pass').map((r) => r.reason).join('\n') ?? '',
      shortlisted: a.shortlisted ? 'Yes' : 'No', finalDecision: a.finalDecision,
      remarks: remarks.filter((r) => r.applicationId === a.id).map((r) => r.text).join('\n'),
    }));
    return { vacancy: { id: vacancy.id, vacancyNo: vacancy.vacancyNo, positionTitle: vacancy.positionTitle }, columns: CV_DATA_COLUMNS.map(({ header, key }) => ({ header, key })), rows };
  }

  /** One Excel per vacancy with the fields read from each CV, in the layout of HR's CV data bank sheet plus the extra CV fields. */
  async exportCvData(vacancyId: string, me: AuthUser) {
    const { vacancy, rows } = await this.cvData(vacancyId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ananta ARS';
    const ws = wb.addWorksheet('CV data');
    ws.columns = CV_DATA_COLUMNS.map((c) => ({ ...c, style: c.key === 'received' ? { numFmt: 'yyyy-mm-dd' } : { alignment: { wrapText: true, vertical: 'top' } } }));
    for (const r of rows) ws.addRow(r);
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9D08E' } }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    await this.audit.log(this.ds.manager, me, 'report.cv_data_export', 'Vacancy', vacancyId, { label: vacancy.vacancyNo, new: { rows: rows.length } });
    return { fileName: `${vacancy.vacancyNo}_CV_data.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  async pendingJobsFor(applicationId: string) {
    return this.ds.getRepository(ProcessingJob).find({ where: { refId: applicationId }, order: { createdAt: 'DESC' } });
  }
}
