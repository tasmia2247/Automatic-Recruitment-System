/**
 * End-to-end acceptance test: walks the full ARS workflow against a real PostgreSQL database
 * and checks the SRS section 24 acceptance criteria (AC-xx) along the way.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { seed } from '../src/database/seed';
import { configureApp } from '../src/main';
import { JobsService } from '../src/processing/jobs.service';

let app: INestApplication;
let ds: DataSource;
let jobs: JobsService;
const agents: Record<string, ReturnType<typeof request.agent>> = {};

async function as(user: string) {
  if (!agents[user]) {
    const a = request.agent(app.getHttpServer());
    await a.post('/api/auth/login').send({ email: `${user}@ars.local`, password: config.seedPassword }).expect(200);
    agents[user] = a;
  }
  return agents[user];
}

const CV_A = `Rahim Uddin
Email: rahim.uddin@example.com   Mobile: 01712-345678
B.Sc in Computer Science and Engineering, North South University
CGPA: 3.45 out of 4.00
3 years of experience in software development
Skills: TypeScript, Node.js, PostgreSQL.`;
const CV_B = `Karim Hasan
Email: karim.hasan@example.com  Phone: 01811-222333
B.Sc in CSE, Dhaka University
CGPA: 2.80
4 years of experience as developer`;
const CV_C = `Sadia Akter
Phone: 01999-888777
BSc in Computer Science, BRAC University
5 years of experience in IT`; // no CGPA and no email
const CV_A_AGAIN = `Rahim Uddin
Email: Rahim.Uddin@Example.com
MBA, IBA University of Dhaka
4 years of experience`;

const ids: Record<string, string> = {};

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  ds = app.get(DataSource);
  jobs = app.get(JobsService);
  await ds.dropDatabase();
  await ds.runMigrations();
  await seed(ds, () => undefined);
  const lk = await (await as('requester.ict')).get('/api/master/lookups').expect(200);
  ids.ict = lk.body.departments.find((d: any) => d.code === 'ICT').id;
  ids.admin = lk.body.departments.find((d: any) => d.code === 'ADMIN').id;
  ids.ho = lk.body.companies.find((c: any) => c.code === 'HO').id;
  ids.dev = lk.body.positions.find((p: any) => p.title === 'Software Developer').id;
});

afterAll(async () => {
  await app?.close();
});

const validForm = () => ({
  departmentId: ids.ict, companyId: ids.ho, positionId: ids.dev, rank: 'Software Developer', headcount: 2, replacePlan: false,
  minEducation: 'B.Sc in CSE', experience: '2 years', salaryPresent: '40,000-60,000', salaryProposed: '45,000-65,000',
  currentQuotaDept: 20, currentQuotaDesig: 10, revisedQuotaDept: 20, revisedQuotaDesig: 12, presentManpowerDept: 16,
  presentManpowerDesig: 8, seatsAvailable: true, deadlineDays: 30, gender: 'Any', jobDescription: 'Build ARS',
  background: 'New ERP projects need two developers.',
});

describe('Requisition and approval gate', () => {
  it('AC-01/AC-02: draft gets a stable ID; incomplete submit shows field errors without losing data', async () => {
    const req = await as('requester.ict');
    const draft = await req.post('/api/requisitions').send({ departmentId: ids.ict, companyId: ids.ho, rank: 'Software Developer' }).expect(201);
    expect(draft.body.reqNo).toMatch(/^REQ-\d{4}-\d{6}$/);
    ids.req = draft.body.id;
    const bad = await req.post(`/api/requisitions/${ids.req}/submit`).expect(400);
    expect(bad.body.fieldErrors).toMatchObject({ headcount: expect.any(String), background: expect.any(String) });
    const after = await req.get(`/api/requisitions/${ids.req}`).expect(200);
    expect(after.body.rank).toBe('Software Developer');
    expect(after.body.status).toBe('Draft');
    expect(after.body.reqNo).toBe(draft.body.reqNo);
  });

  it('AC-08: Replace Plan = Yes requires replacement details', async () => {
    const req = await as('requester.ict');
    await req.put(`/api/requisitions/${ids.req}`).send({ ...validForm(), replacePlan: true }).expect(200);
    const bad = await req.post(`/api/requisitions/${ids.req}/submit`).expect(400);
    expect(Object.keys(bad.body.fieldErrors)).toEqual(expect.arrayContaining(['replacementEmployeeName', 'terminationReference']));
  });

  it('AC-07: vacancy is calculated as quota minus present manpower', async () => {
    const req = await as('requester.ict');
    const r = await req.put(`/api/requisitions/${ids.req}`).send(validForm()).expect(200);
    expect(r.body.vacancyDept).toBe(4);
    expect(r.body.vacancyDesig).toBe(2);
  });

  it('AC-03/AC-04: submitted requisition appears only in the first approver inbox', async () => {
    const req = await as('requester.ict');
    await req.post(`/api/requisitions/${ids.req}/submit`).expect(200);
    const dir = await (await as('director')).get('/api/approvals/inbox').expect(200);
    expect(dir.body.pending.map((p: any) => p.requisition.id)).toContain(ids.req);
    const hr = await (await as('concerned.hr')).get('/api/approvals/inbox').expect(200);
    expect(hr.body.pending).toHaveLength(0);
    // Later approvers see it coming (view only); the Super Admin sees every pending approval.
    expect(hr.body.upcoming.map((p: any) => p.requisition.id)).toContain(ids.req);
    expect(hr.body.upcoming[0].currentApprover.step).toBe('Concerned Director');
    expect(hr.body.all).toBeNull();
    const admin = await (await as('admin')).get('/api/approvals/inbox').expect(200);
    expect(admin.body.pending).toHaveLength(0);
    expect(admin.body.all.find((p: any) => p.requisition.id === ids.req)).toMatchObject({ stepLabel: 'Concerned Director', approver: { name: 'Concerned Director' } });
    await (await as('admin')).post(`/api/requisitions/${ids.req}/approve`).send({}).expect(400); // on behalf needs the step id
    const notes = await (await as('admin')).get('/api/notifications').expect(200);
    expect(notes.body.items.some((n: any) => n.event === 'approval.submitted' && n.link === '/approvals')).toBe(true);
    const adm = await as('approval.admin');
    expect((await adm.get('/api/approvals/inbox').expect(200)).body.all.map((p: any) => p.requisition.id)).toContain(ids.req);
    expect((await adm.get('/api/notifications').expect(200)).body.items.some((n: any) => n.event === 'approval.submitted')).toBe(true);
    await (await as('recruiter')).get('/api/approvals/inbox').expect(403); // HR does not approve
  });

  it('department users see their own department; HR, Admin and Super Admin see every department', async () => {
    const reqIds = async (u: string) => (await (await as(u)).get('/api/requisitions').expect(200)).body.items.map((r: any) => r.id);
    for (const u of ['requester.ict', 'admin', 'recruiter', 'approval.admin']) expect(await reqIds(u)).toContain(ids.req);
    for (const u of ['requester.admin', 'corporate.hr']) expect(await reqIds(u)).not.toContain(ids.req);
    const quotaDepts = async (u: string, query = '') =>
      new Set((await (await as(u)).get(`/api/master/quotas${query}`).expect(200)).body.map((q: any) => q.departmentId));
    expect([...(await quotaDepts('requester.ict', `?departmentId=${ids.admin}`))]).toEqual([ids.ict]); // filter cannot widen scope
    expect([...(await quotaDepts('requester.admin'))]).toEqual([ids.admin]);
    expect((await quotaDepts('recruiter')).size).toBeGreaterThan(1); // HR: every department (view)
    expect((await quotaDepts('admin')).size).toBeGreaterThan(1);
    await (await as('approval.admin')).get('/api/master/quotas').expect(403); // Admin: no positions & quota
    await (await as('recruiter')).post('/api/master/quotas').send({ companyId: ids.ho, departmentId: ids.ict, approvedQuota: 1 }).expect(403);
    // A user with no department gets a clear refusal on scoped lists, but the dashboard still loads.
    await (await as('viewer')).get('/api/requisitions').expect(403);
    await (await as('viewer')).get('/api/dashboard').expect(200);
  });

  it('AC-24: department scope and permissions are enforced server-side', async () => {
    await (await as('requester.admin')).get(`/api/requisitions/${ids.req}`).expect(403);
    await (await as('requester.ict')).post(`/api/requisitions/${ids.req}/approve`).send({}).expect(403);
    await (await as('screener')).get('/api/hr-queue').expect(403);
    await (await as('concerned.hr')).post(`/api/requisitions/${ids.req}/approve`).send({}).expect(403); // not their step yet
    await request(app.getHttpServer()).get('/api/requisitions').expect(401);
  });

  it('AC-05: a pending requisition cannot become a vacancy', async () => {
    await (await as('hr.manager')).post(`/api/hr-queue/${ids.req}/vacancy`).expect(409);
    await (await as('recruiter')).post(`/api/hr-queue/${ids.req}/vacancy`).expect(403); // HR Manager creates vacancies
  });

  it('AC-09: a repeated approval click is recorded once', async () => {
    const dir = await as('director');
    const first = await dir.post(`/api/requisitions/${ids.req}/approve`).send({ remarks: 'OK' }).expect(200);
    expect(first.body.duplicate).toBe(false);
    const again = await dir.post(`/api/requisitions/${ids.req}/approve`).send({ remarks: 'OK' }).expect(200);
    expect(again.body.duplicate).toBe(true);
    const n = await ds.query(`SELECT count(*)::int AS n FROM approval_actions WHERE "requisitionId" = $1 AND status = 'Approved'`, [ids.req]);
    expect(n[0].n).toBe(1);
    const hr = await (await as('concerned.hr')).get('/api/approvals/inbox').expect(200);
    expect(hr.body.pending).toHaveLength(1);
  });

  it('AC-06: return needs a comment; resubmit without critical changes resumes at the returning step', async () => {
    await (await as('concerned.hr')).post(`/api/requisitions/${ids.req}/approve`).send({}).expect(200);
    const aded = await as('aded');
    await aded.post(`/api/requisitions/${ids.req}/return`).send({ reason: '' }).expect(400);
    await aded.post(`/api/requisitions/${ids.req}/return`).send({ reason: 'Please clarify the JD.' }).expect(200);
    const req = await as('requester.ict');
    const notes = await req.get('/api/notifications').expect(200);
    expect(notes.body.items.some((n: any) => n.event === 'requisition.returned')).toBe(true);
    await req.put(`/api/requisitions/${ids.req}`).send({ ...validForm(), jobDescription: 'Build and maintain ARS modules.' }).expect(200);
    await req.post(`/api/requisitions/${ids.req}/submit`).expect(200);
    const d = await req.get(`/api/requisitions/${ids.req}`).expect(200);
    expect(d.body.version).toBe(2);
    const v2 = d.body.approvals.filter((a: any) => a.version === 2);
    expect(v2.find((a: any) => a.stepLabel === 'Concerned Director')).toMatchObject({ status: 'Approved', carriedOver: true });
    expect(v2.find((a: any) => a.stepLabel === 'Concerned AD/ED').status).toBe('Pending');
    expect(d.body.approvals.filter((a: any) => a.version === 1)).toHaveLength(5); // history retained
  });

  it('completes the route: Approved -> Sent to HR; HR queue lists it; vacancy creation is idempotent', async () => {
    for (const u of ['aded', 'corporate.hr', 'hod.hr']) await (await as(u)).post(`/api/requisitions/${ids.req}/approve`).send({}).expect(200);
    const req = await as('requester.ict');
    expect((await req.get(`/api/requisitions/${ids.req}`)).body.status).toBe('Sent to HR');
    const hr = await as('hr.manager');
    const q = await hr.get('/api/hr-queue').expect(200);
    expect(q.body.items.find((i: any) => i.id === ids.req)).toMatchObject({ coordinator: null });
    await (await as('recruiter')).get('/api/hr-queue').expect(403); // queue: HR Manager and Super Admin only
    await (await as('approval.admin')).get('/api/hr-queue').expect(403);
    await hr.get(`/api/requisitions/${ids.req}`).expect(200); // HR opens approved requisitions of any department
    // The coordinator list is every active HR user; it is chosen in the queue before the vacancy exists.
    const coordinators = (await hr.get('/api/hr-queue/coordinators').expect(200)).body;
    ids.recruiter = coordinators.find((u: any) => u.email === 'recruiter@ars.local').id;
    ids.recruiter2 = coordinators.find((u: any) => u.email === 'recruiter2@ars.local').id;
    expect(coordinators.map((u: any) => u.email)).not.toContain('admin@ars.local');
    await hr.put(`/api/hr-queue/${ids.req}/coordinator`).send({ coordinatorId: ids.recruiter }).expect(200);
    expect((await (await as('requester.ict')).get('/api/requisitions').expect(200)).body.items.find((r: any) => r.id === ids.req).status).toBe('Sent to HR');
    const v1 =await hr.post(`/api/hr-queue/${ids.req}/vacancy`).expect(200);
    const v2 = await hr.post(`/api/hr-queue/${ids.req}/vacancy`).expect(200);
    expect(v2.body.duplicate).toBe(true);
    expect(v2.body.vacancy.id).toBe(v1.body.vacancy.id);
    expect(v1.body.vacancy.vacancyNo).toMatch(/^VAC-/);
    ids.vacancy = v1.body.vacancy.id;
    expect(v1.body.vacancy.coordinatorId).toBe(ids.recruiter); // the vacancy inherits the queue's coordinator
  });

  it('quota stays unchanged until Corporate HR inserts the approved revision into the quota chart', async () => {
    const quota = async () => (await (await as('requester.ict')).get('/api/master/quotas')).body.find((q: any) => q.positionId === ids.dev).approvedQuota;
    expect(await quota()).toBe(10);
    await (await as('corporate.hr')).post(`/api/requisitions/${ids.req}/corporate-hr`).send({ insertedInQuotaChart: 'Yes', corporateHrRemarks: 'Inserted' }).expect(200);
    expect(await quota()).toBe(12);
  });

  it('AC-06/AC-05: rejection requires a reason and a rejected requisition cannot become a vacancy', async () => {
    const req = await as('requester.ict');
    const r = await req.post('/api/requisitions').send(validForm()).expect(201);
    await req.post(`/api/requisitions/${r.body.id}/submit`).expect(200);
    const dir = await as('director');
    await dir.post(`/api/requisitions/${r.body.id}/reject`).send({}).expect(400);
    await dir.post(`/api/requisitions/${r.body.id}/reject`).send({ reason: 'Budget not available.' }).expect(200);
    await dir.post(`/api/requisitions/${r.body.id}/approve`).send({}).expect(409);
    await (await as('hr.manager')).post(`/api/hr-queue/${r.body.id}/vacancy`).expect(409);
    await (await as('hr.manager')).put(`/api/hr-queue/${r.body.id}/coordinator`).send({ coordinatorId: ids.recruiter }).expect(409);
  });
});

describe('Vacancy, job post, CV intake and screening', () => {
  it('AC-10: direct HR vacancy needs explicit permission and is marked Direct HR Entry', async () => {
    const body = { departmentId: ids.ict, companyId: ids.ho, positionTitle: 'QA Engineer', headcount: 1, vacancyType: 'NEW', directReason: 'Urgent project need approved by management' };
    await (await as('screener')).post('/api/vacancies/direct').send(body).expect(403);
    await (await as('recruiter')).post('/api/vacancies/direct').send(body).expect(403);
    const v = await (await as('hr.manager')).post('/api/vacancies/direct').send(body).expect(201);
    expect(v.body.source).toBe('DIRECT_HR');
    expect(v.body.requisitionId).toBeNull();
    ids.vacancy2 = v.body.id;
    await (await as('recruiter')).get(`/api/vacancies/${ids.vacancy2}`).expect(403); // not their vacancy yet
    await (await as('hr.manager')).put(`/api/vacancies/${ids.vacancy2}/coordinator`).send({ coordinatorId: ids.recruiter }).expect(200);
    await (await as('recruiter')).get(`/api/vacancies/${ids.vacancy2}`).expect(200);
  });

  it('AC-11: job post with versioned criteria; publishing requires criteria', async () => {
    const hr = await as('recruiter');
    const jp = await hr.post(`/api/vacancies/${ids.vacancy}/job-posts`).send({ title: 'Software Developer', startDate: '2026-11-01', deadline: '2026-11-30' }).expect(201);
    ids.jobPost = jp.body.id;
    await hr.post(`/api/job-posts/${ids.jobPost}/status`).send({ status: 'Published' }).expect(409);
    const set = await hr.post(`/api/job-posts/${ids.jobPost}/criteria`).send({ criteria: [
      { label: 'Relevant degree', field: 'degree', operator: 'contains_any', value: 'BSc, B.Sc, CSE, Computer', mandatory: true, missingPolicy: 'REVIEW' },
      { label: 'CGPA >= 3.00', field: 'cgpa', operator: 'gte', value: '3.00', mandatory: true, missingPolicy: 'REVIEW' },
      { label: '2+ years experience', field: 'totalExperienceYears', operator: 'gte', value: '2', mandatory: true, missingPolicy: 'REVIEW' },
    ] }).expect(201);
    expect(set.body.version).toBe(1);
    await hr.post(`/api/job-posts/${ids.jobPost}/status`).send({ status: 'Published' }).expect(200);
  });

  it('manual upload: per-file results; bad file does not cancel good ones; same file twice is rejected', async () => {
    const hr = await as('recruiter');
    const res = await hr.post(`/api/vacancies/${ids.vacancy}/cvs`)
      .attach('files', Buffer.from(CV_A), 'rahim.txt').attach('files', Buffer.from(CV_B), 'karim.txt')
      .attach('files', Buffer.from(CV_C), 'sadia.txt').attach('files', Buffer.from('MZ binary'), 'virus.exe').expect(201);
    expect(res.body.map((r: any) => r.ok)).toEqual([true, true, true, false]);
    expect(res.body[3].error).toMatch(/Unsupported file type/);
    const again = await hr.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from(CV_A), 'rahim-copy.txt').expect(201);
    expect(again.body[0]).toMatchObject({ ok: false, error: expect.stringMatching(/already received/) });
    [ids.appA, ids.appB, ids.appC] = res.body.slice(0, 3).map((r: any) => r.applicationId);
    await jobs.drain();
  });

  it('AC-14/AC-15: extraction does not fabricate; screening outcomes carry criterion-level reasons', async () => {
    const hr = await as('recruiter');
    const list = await hr.get(`/api/vacancies/${ids.vacancy}/applications`).expect(200);
    const byId = Object.fromEntries(list.body.items.map((a: any) => [a.id, a]));
    expect(byId[ids.appA]).toMatchObject({ screeningResult: 'Pass', cgpa: 3.45, totalExperienceYears: 3 });
    expect(byId[ids.appA].candidate).toMatchObject({ name: 'Rahim Uddin', email: 'rahim.uddin@example.com' });
    expect(byId[ids.appB].screeningResult).toBe('Fail');
    expect(byId[ids.appB].screeningReasons.join(' ')).toMatch(/CGPA/);
    expect(byId[ids.appC]).toMatchObject({ screeningResult: 'Review Required', cgpa: null, extractionStatus: 'Review Required' });
    expect(byId[ids.appC].candidate.email).toBeNull();
    expect(list.body.items[0].id).toBe(ids.appA); // default order Pass, Review, Fail
    expect(list.body.items[2].id).toBe(ids.appB);
  });

  it('AC-16: a new criteria version does not rewrite earlier screening results', async () => {
    const hr = await as('recruiter');
    await hr.post(`/api/job-posts/${ids.jobPost}/criteria`).send({ criteria: [
      { label: 'CGPA >= 2.50', field: 'cgpa', operator: 'gte', value: '2.5', mandatory: true, missingPolicy: 'REVIEW' },
    ] }).expect(201);
    const d = await hr.get(`/api/applications/${ids.appB}`).expect(200);
    expect(d.body.screeningRuns).toHaveLength(1);
    expect(d.body.screeningRuns[0]).toMatchObject({ criteriaVersion: 1, overallResult: 'Fail' });
    await hr.post(`/api/vacancies/${ids.vacancy}/rescreen`).expect(200);
    await jobs.drain();
    const d2 = await hr.get(`/api/applications/${ids.appB}`).expect(200);
    expect(d2.body.screeningRuns.map((r: any) => [r.criteriaVersion, r.overallResult])).toEqual([[2, 'Pass'], [1, 'Fail']]);
    // Restore v1-equivalent rules for the rest of the flow.
    await hr.post(`/api/job-posts/${ids.jobPost}/criteria`).send({ criteria: [
      { label: 'CGPA >= 3.00', field: 'cgpa', operator: 'gte', value: '3.00', mandatory: true, missingPolicy: 'REVIEW' },
    ] }).expect(201);
    await hr.post(`/api/vacancies/${ids.vacancy}/rescreen`).expect(200);
    await jobs.drain();
  });

  it('human correction is audited and protected from re-extraction', async () => {
    const hr = await as('recruiter');
    await hr.patch(`/api/applications/${ids.appC}`).send({ email: 'sadia.akter@example.com' }).expect(200);
    // Bangla text must round-trip (database must be UTF8).
    await hr.post(`/api/applications/${ids.appC}/remarks`).send({ text: 'সাক্ষাৎকারের জন্য উপযুক্ত' }).expect(201);
    expect((await hr.get(`/api/applications/${ids.appC}`)).body.remarks[0].text).toBe('সাক্ষাৎকারের জন্য উপযুক্ত');
    const audit = await (await as('admin')).get(`/api/audit?entityType=Candidate`).expect(200);
    expect(audit.body.items.some((e: any) => e.action === 'candidate.correct' && e.newValues.email === 'sadia.akter@example.com' && e.oldValues.email === null)).toBe(true);
  });

  it('AC-13: the same person applying to a second vacancy is flagged, then merged to one Candidate ID', async () => {
    const hr = await as('recruiter');
    const up = await hr.post(`/api/vacancies/${ids.vacancy2}/cvs`).attach('files', Buffer.from(CV_A_AGAIN), 'rahim2.txt').expect(201);
    await jobs.drain();
    const appId = up.body[0].applicationId;
    ids.appA2 = appId;
    const d = await hr.get(`/api/applications/${appId}`).expect(200);
    expect(d.body.duplicateReview).toBe('PENDING');
    expect(d.body.duplicateEvidence).toMatch(/same email/);
    const a = await hr.get(`/api/applications/${ids.appA}`).expect(200);
    expect(d.body.candidateId).not.toBe(a.body.candidateId); // never auto-merged
    await hr.post(`/api/applications/${appId}/duplicate`).send({ action: 'MERGE' }).expect(200);
    const merged = await hr.get(`/api/applications/${appId}`).expect(200);
    expect(merged.body.candidateId).toBe(a.body.candidateId);
    expect(merged.body.applicationNo).not.toBe(a.body.applicationNo);
  });

  it('AC-17: vacancy-wise Excel export has required columns, one row per application, matching IDs', async () => {
    const res = await (await as('recruiter')).get(`/api/vacancies/${ids.vacancy}/export`).buffer(true)
      .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as any[]).slice(1);
    expect(header).toEqual(['Candidate ID', 'Application ID', 'Candidate Name', 'Education', 'Institution', 'CGPA', 'Work Experience (years)', 'Workplace', 'Email', 'Phone', 'Applied Position', 'Screening Status', 'Screening Reasons', 'Remarks']);
    expect(ws.rowCount - 1).toBe(3);
    const a = await (await as('recruiter')).get(`/api/applications/${ids.appA}`);
    expect(ws.getRow(2).getCell(2).value).toBe(a.body.applicationNo);
    await (await as('examiner')).get(`/api/vacancies/${ids.vacancy}/export`).expect(403);
  });
});

describe('Selection, evaluation, communication and joining', () => {
  it('AC-18: overriding a Fail needs a reason and leaves the screening result untouched', async () => {
    const hr = await as('recruiter');
    const noReason = await hr.post(`/api/vacancies/${ids.vacancy}/shortlist`).send({ applicationIds: [ids.appA, ids.appB], shortlisted: true }).expect(200);
    expect(noReason.body.find((r: any) => r.applicationId === ids.appA).ok).toBe(true);
    expect(noReason.body.find((r: any) => r.applicationId === ids.appB)).toMatchObject({ ok: false, error: expect.stringMatching(/override reason/) });
    await hr.post(`/api/vacancies/${ids.vacancy}/shortlist`).send({ applicationIds: [ids.appB, ids.appC], shortlisted: true, reason: 'Strong practical experience' }).expect(200);
    const b = await hr.get(`/api/applications/${ids.appB}`).expect(200);
    expect(b.body).toMatchObject({ shortlisted: true, screeningResult: 'Fail', shortlistReason: 'Strong practical experience' });
  });

  it('AC-19: invitations are individual emails with per-recipient status; same request is never sent twice', async () => {
    const hr = await as('recruiter');
    await hr.post(`/api/vacancies/${ids.vacancy}/schedule`).send({ applicationIds: [ids.appA, ids.appB, ids.appC], stageType: 'INTERVIEW', scheduledAt: '2026-11-10T04:00:00Z', location: 'Ananta Head Office, Uttara' }).expect(200);
    const tpl = (await hr.get('/api/email/templates?kind=INTERVIEW_INVITE').expect(200)).body[0];
    const payload = { applicationIds: [ids.appA, ids.appB, ids.appC], kind: 'INTERVIEW_INVITE', templateId: tpl.id, subject: tpl.subject, body: tpl.body, variables: { instructions: 'Bring your NID.' } };
    const prev = await hr.post('/api/email/preview').send(payload).expect(200);
    expect(prev.body.every((p: any) => p.ok)).toBe(true);
    expect(prev.body[0].body).toContain('Rahim Uddin');
    await hr.post('/api/email/send').send({ ...payload, clientKey: 'k-invite-0001', confirmed: false }).expect(400);
    const sent = await hr.post('/api/email/send').send({ ...payload, clientKey: 'k-invite-0001', confirmed: true }).expect(200);
    expect(sent.body.results.map((r: any) => r.status)).toEqual(['Queued', 'Queued', 'Queued']);
    await jobs.drain();
    const again = await hr.post('/api/email/send').send({ ...payload, clientKey: 'k-invite-0001', confirmed: true }).expect(200);
    expect(again.body.duplicate).toBe(true);
    const events = await ds.query(`SELECT recipient, status, transport FROM email_events`);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e: any) => e.recipient)).size).toBe(3);
    expect(events.every((e: any) => e.status === 'Sent' && e.transport === 'dev-outbox')).toBe(true);
  });

  const marksFile = async (rows: (string | number | null)[][]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Marks');
    ws.addRow(['Application ID', 'Candidate ID', 'Candidate Name', 'Marks']);
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  it('AC-20: marks import previews unmatched/duplicate/invalid rows and saves only after confirmation', async () => {
    const hr = await as('examiner');
    const a = (await hr.get(`/api/applications/${ids.appA}`)).body;
    const b = (await hr.get(`/api/applications/${ids.appB}`)).body;
    const file = await marksFile([
      [a.applicationNo, a.candidate.candidateNo, 'Rahim', 78], [b.applicationNo, null, 'Karim', 64],
      ['APP-1999-999999', null, 'Ghost', 50], [a.applicationNo, null, 'Rahim dup', 80], [null, null, 'Name only', 70],
    ]);
    const prev = await hr.post(`/api/vacancies/${ids.vacancy}/marks-import?stageType=WRITTEN&maxMarks=100`).attach('file', file, 'written.xlsx').expect(201);
    expect(prev.body).toMatchObject({ status: 'Previewed', rowsTotal: 5, rowsAccepted: 2, rowsRejected: 3 });
    expect(prev.body.rows.map((r: any) => r.status)).toEqual(['Valid', 'Valid', 'Error', 'Error', 'Error']);
    expect((await ds.query(`SELECT count(*)::int AS n FROM evaluation_marks`))[0].n).toBe(0);
    const ok = await hr.post(`/api/imports/${prev.body.id}/confirm`).send({}).expect(200);
    expect(ok.body.saved).toBe(2);
    expect((await hr.post(`/api/imports/${prev.body.id}/confirm`).send({}).expect(200)).body.duplicate).toBe(true);
    // Replacing an existing mark requires explicit overwrite + permission.
    const file2 = await marksFile([[a.applicationNo, null, 'Rahim', 82]]);
    const p2 = await hr.post(`/api/vacancies/${ids.vacancy}/marks-import?stageType=WRITTEN&maxMarks=100`).attach('file', file2, 'written2.xlsx').expect(201);
    expect(p2.body.rows[0]).toMatchObject({ status: 'Overwrite', previousMarks: 78 });
    await hr.post(`/api/imports/${p2.body.id}/confirm`).send({ allowOverwrite: true }).expect(403); // examiner lacks overwrite permission
    await (await as('recruiter')).post(`/api/imports/${p2.body.id}/confirm`).send({ allowOverwrite: true }).expect(200);
    expect((await ds.query(`SELECT count(*)::int AS n FROM evaluation_marks`))[0].n).toBe(2);
  });

  it('AC-21: interview marks are linked to the application with evaluator and timestamp; attendance is explicit', async () => {
    const ex = await as('examiner');
    await ex.put(`/api/applications/${ids.appA}/marks`).send({ stageType: 'INTERVIEW', marks: 120, maxMarks: 100 }).expect(400);
    await ex.put(`/api/applications/${ids.appA}/marks`).send({ stageType: 'INTERVIEW', marks: 85, maxMarks: 100, remarks: 'Good' }).expect(200);
    await ex.put(`/api/applications/${ids.appA}/stages/interview`).send({ attendance: 'Present' }).expect(200);
    const board = await ex.get(`/api/vacancies/${ids.vacancy}/evaluation`).expect(200);
    const rowA = board.body.rows.find((r: any) => r.applicationId === ids.appA);
    expect(rowA.marks.find((m: any) => m.stageType === 'INTERVIEW')).toMatchObject({ marks: 85, evaluator: { name: 'Interview Examiner' } });
    expect(rowA.stages.INTERVIEW.attendance).toBe('Present');
    const rowC = board.body.rows.find((r: any) => r.applicationId === ids.appC);
    expect(rowC.stages.INTERVIEW.attendance).toBe('Not Recorded');
  });

  it('AC-22: only authorized HR records the final decision; stage results remain', async () => {
    await (await as('examiner')).post(`/api/applications/${ids.appA}/final-decision`).send({ decision: 'Selected' }).expect(403);
    const hr = await as('recruiter');
    await hr.post(`/api/applications/${ids.appA}/final-decision`).send({ decision: 'Selected', remarks: 'Top scorer' }).expect(200);
    await hr.post(`/api/applications/${ids.appB}/final-decision`).send({ decision: 'Not Selected' }).expect(200);
    const a = await hr.get(`/api/applications/${ids.appA}`).expect(200);
    expect(a.body.finalDecision).toBe('Selected');
    expect(a.body.marks).toHaveLength(2);
  });

  it('AC-23: a result/joining email does not mark joined; only HR approval does, once', async () => {
    const hr = await as('recruiter');
    const pending = await hr.get('/api/joining/pending').expect(200);
    expect(pending.body).toHaveLength(1);
    const j = pending.body[0];
    const tpl = (await hr.get('/api/email/templates?kind=JOINING_LETTER')).body[0];
    await hr.put(`/api/joining/${j.id}`).send({ joiningDate: '2026-12-01' }).expect(200);
    await hr.post('/api/email/send').send({ applicationIds: [ids.appA], kind: 'JOINING_LETTER', templateId: tpl.id, subject: tpl.subject, body: tpl.body, variables: { reportingTime: '9:00 AM', contactPerson: 'HR desk' }, clientKey: 'k-join-0001', confirmed: true }).expect(200);
    await jobs.drain();
    expect((await hr.get('/api/joining/joined')).body.total).toBe(0);
    expect((await hr.get('/api/joining/pending')).body[0].letterStatus).toBe('Sent');
    await hr.post(`/api/joining/${j.id}/approve`).send({}).expect(400); // joining date required
    const ok = await hr.post(`/api/joining/${j.id}/approve`).send({ joiningDate: '2026-12-01' }).expect(200);
    expect(ok.body.duplicate).toBe(false);
    expect((await hr.post(`/api/joining/${j.id}/approve`).send({ joiningDate: '2026-12-01' }).expect(200)).body.duplicate).toBe(true);
    const joined = await hr.get('/api/joining/joined').expect(200);
    expect(joined.body.total).toBe(1);
    expect(joined.body.items[0]).toMatchObject({ name: 'Rahim Uddin', joiningDate: '2026-12-01' });
    expect((await ds.query(`SELECT count(*)::int AS n FROM joining_records WHERE status = 'Approved'`))[0].n).toBe(1);
  });

  it('AC-25: critical changes are audited with actor, record and old/new values', async () => {
    const audit = await (await as('admin')).get('/api/audit?pageSize=500').expect(200);
    const actions = new Set(audit.body.items.map((e: any) => e.action));
    for (const a of ['requisition.submit', 'requisition.approve_step', 'requisition.return', 'requisition.approve_final', 'requisition.reject',
      'vacancy.create_from_requisition', 'criteria.new_version', 'selection.shortlist_override', 'marks.import_confirm', 'selection.final_decision', 'joining.approve', 'email.sent']) {
      expect(actions).toContain(a);
    }
    const final = audit.body.items.find((e: any) => e.action === 'selection.final_decision');
    expect(final).toMatchObject({ actorName: 'HR Recruiter', oldValues: { finalDecision: 'Pending' }, newValues: { finalDecision: expect.any(String) } });
    await (await as('recruiter')).get('/api/audit').expect(403);
  });

  it('AC-26: retrying failed processing does not duplicate applications', async () => {
    const hr = await as('recruiter');
    const up = await hr.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from('%PDF-1.4 not really a pdf'), 'broken.pdf').expect(201);
    await jobs.drain();
    const appId = up.body[0].applicationId;
    expect((await hr.get(`/api/applications/${appId}`)).body.processingStatus).toBe('Failed');
    const before = (await ds.query(`SELECT count(*)::int AS n FROM applications`))[0].n;
    const job = (await ds.query(`SELECT id FROM processing_jobs WHERE "refId" = $1 AND status = 'Failed'`, [appId]))[0];
    await hr.post(`/api/monitor/jobs/${job.id}/retry`).expect(403); // HR: operational view only
    const mgr = await as('hr.manager');
    expect((await mgr.post(`/api/monitor/jobs/${job.id}/retry`).expect(200)).body.retried).toBe(true);
    await jobs.drain();
    expect((await ds.query(`SELECT count(*)::int AS n FROM applications`))[0].n).toBe(before);
    expect((await mgr.post(`/api/monitor/jobs/${job.id}/retry`).expect(200)).body.retried).toBe(true); // failed again, still retryable
  });

  it('AC-27: dashboard counts come from real records and respect role visibility', async () => {
    const hr = await (await as('recruiter')).get('/api/dashboard').expect(200);
    const mine = (await ds.query(`SELECT count(*)::int AS n FROM applications a JOIN vacancies v ON v.id = a."vacancyId" WHERE v."coordinatorId" = $1`, [ids.recruiter]))[0].n;
    expect(hr.body.hr).toMatchObject({ assignedOnly: true, cvs: { received: mine }, joining: { joined: 1 } });
    expect(hr.body.hr.queue).toBeUndefined();
    expect(hr.body.department).toBeUndefined();
    expect(hr.body.admin).toBeUndefined();
    const dept = await (await as('requester.admin')).get('/api/dashboard').expect(200);
    expect(dept.body.hr).toBeUndefined();
    expect(dept.body.department).toMatchObject({ name: 'Administration', requisitions: { total: 0, pending: 0, approved: 0 }, joined: 0 });
    const ict = (await (await as('requester.ict')).get('/api/dashboard').expect(200)).body.department;
    const ictReqs = (await ds.query(`SELECT count(*)::int AS n FROM requisitions WHERE "departmentId" = $1 AND status <> 'Draft'`, [ids.ict]))[0].n;
    expect(ict).toMatchObject({ name: 'ICT', joined: 1, requisitions: { total: ictReqs } });
    expect(ict.quota.vacant).toBeGreaterThanOrEqual(0);
    const adm = (await (await as('approval.admin')).get('/api/dashboard').expect(200)).body;
    const all = (await ds.query(`SELECT count(*)::int AS n FROM requisitions WHERE status <> 'Draft'`))[0].n;
    expect(adm.admin.requisitions.total).toBe(all);
    expect(adm.hr).toBeUndefined();
    expect(adm.department).toBeUndefined();
    const sa = (await (await as('admin')).get('/api/dashboard').expect(200)).body;
    expect(sa.department.name).toBeNull(); // Super Admin: all departments
    expect(sa.hr.assignedOnly).toBe(false);
    expect(sa.admin.requisitions.total).toBe(all);
  });
});

describe('Candidate CV Bank (department -> vacancy -> candidates) and application status', () => {
  const statusOf = (rows: any[], id: string) => rows.find((r) => r.applicationId === id)?.status;

  it('tree groups vacancies by department with server-side department filter and counts', async () => {
    const hr = await as('recruiter');
    const t = await hr.get('/api/cv-bank/tree').expect(200);
    const ict = t.body.departments.find((d: any) => d.id === ids.ict);
    expect(ict.vacancies.find((v: any) => v.id === ids.vacancy).total).toBe(4);
    expect(ict.vacancies.find((v: any) => v.id === ids.vacancy2).total).toBe(1);
    expect(t.body.departments.find((d: any) => d.id === ids.admin).vacancies).toEqual([]);
    const onlyAdmin = await hr.get(`/api/cv-bank/tree?departmentId=${ids.admin}`).expect(200);
    expect(onlyAdmin.body.departments.map((d: any) => d.id)).toEqual([ids.admin]);
    const a = (await hr.get(`/api/applications/${ids.appA}`)).body;
    const byCand = await hr.get(`/api/cv-bank/tree?q=${a.candidate.candidateNo}`).expect(200);
    const vs = byCand.body.departments.find((d: any) => d.id === ids.ict).vacancies;
    expect(vs.find((v: any) => v.id === ids.vacancy).matching).toBe(1);
    expect(vs.find((v: any) => v.id === ids.vacancy2).matching).toBe(1);
  });

  it('candidate list derives each application status and filters by vacancy, department, status and IDs', async () => {
    const hr = await as('recruiter');
    const list = await hr.get(`/api/cv-bank/applications?vacancyId=${ids.vacancy}`).expect(200);
    expect(list.body.total).toBe(4);
    expect(statusOf(list.body.items, ids.appA)).toBe('Joined');
    expect(statusOf(list.body.items, ids.appB)).toBe('Not Selected');
    expect(statusOf(list.body.items, ids.appC)).toBe('Interview');
    const rowA = list.body.items.find((r: any) => r.applicationId === ids.appA);
    expect(rowA).toMatchObject({ department: 'ICT', companyCode: 'HO', positionTitle: 'Software Developer', criteriaMet: 1, criteriaTotal: 1, documentName: 'rahim.txt' });
    expect(list.body.items.find((r: any) => r.processingStatus === 'Failed').status).toBe('Review Required');
    expect(list.body.items.find((r: any) => r.applicationId === ids.appC)).toMatchObject({ remarkCount: 1, latestRemark: 'সাক্ষাৎকারের জন্য উপযুক্ত' });
    const ns = await hr.get('/api/cv-bank/applications?status=Not%20Selected').expect(200);
    expect(ns.body.items.map((r: any) => r.applicationId)).toEqual([ids.appB]);
    expect((await hr.get(`/api/cv-bank/applications?departmentId=${ids.admin}`).expect(200)).body.total).toBe(0);
    expect((await hr.get(`/api/cv-bank/applications?q=${rowA.applicationNo}`).expect(200)).body.items.map((r: any) => r.applicationId)).toEqual([ids.appA]);
    const both = await hr.get(`/api/cv-bank/applications?q=${rowA.candidateNo}`).expect(200);
    expect(both.body.items).toHaveLength(2);
    expect(new Set(both.body.items.map((r: any) => r.candidateNo)).size).toBe(1);
    expect(new Set(both.body.items.map((r: any) => r.applicationNo)).size).toBe(2);
    expect(statusOf(both.body.items, ids.appA2)).toBe('Screening');
    await (await as('requester.admin')).get('/api/cv-bank/applications').expect(403);
    await (await as('requester.admin')).get('/api/cv-bank/tree').expect(403);
  });

  it('status changes follow the workflow, check permissions and touch only the selected application', async () => {
    const hr = await as('recruiter');
    const jp = await hr.post(`/api/vacancies/${ids.vacancy2}/job-posts`).send({ title: 'QA Engineer' }).expect(201);
    await hr.post(`/api/job-posts/${jp.body.id}/criteria`).send({ criteria: [
      { label: '2+ years experience', field: 'totalExperienceYears', operator: 'gte', value: '2', mandatory: true, missingPolicy: 'REVIEW' },
    ] }).expect(201);
    await hr.post(`/api/vacancies/${ids.vacancy2}/rescreen`).expect(200);
    await jobs.drain();
    const row = async (id: string) => (await hr.get(`/api/cv-bank/applications?q=${(await hr.get(`/api/applications/${id}`)).body.applicationNo}`)).body.items[0];
    expect((await row(ids.appA2)).status).toBe('Pass');
    expect((await row(ids.appA2)).transitions.map((t: any) => t.status)).toEqual(['Shortlisted']);

    const change = (agent: any, id: string, body: any) => agent.post(`/api/applications/${id}/status`).send(body);
    await change(await as('examiner'), ids.appA2, { fromStatus: 'Pass', status: 'Shortlisted' }).expect(403);
    await change(await as('screener'), ids.appA2, { fromStatus: 'Pass', status: 'Shortlisted' }).expect(403);
    await change(hr, ids.appA2, { fromStatus: 'Review Required', status: 'Shortlisted' }).expect(409); // stale view
    await change(hr, ids.appA2, { fromStatus: 'Pass', status: 'Selected' }).expect(400); // must be shortlisted first
    await change(hr, ids.appA2, { fromStatus: 'Pass', status: 'Received' }).expect(400); // system-only status

    const s1 = await change(hr, ids.appA2, { fromStatus: 'Pass', status: 'Shortlisted' }).expect(200);
    expect(s1.body).toMatchObject({ status: 'Shortlisted', screeningResult: 'Pass' });
    expect((await row(ids.appA)).status).toBe('Joined'); // same candidate, other vacancy unchanged

    await change(hr, ids.appA2, { fromStatus: 'Shortlisted', status: 'Pass' }).expect(400); // un-shortlist needs a reason
    await change(hr, ids.appA2, { fromStatus: 'Shortlisted', status: 'Joined' }).expect(400);
    const s2 = await change(hr, ids.appA2, { fromStatus: 'Shortlisted', status: 'Selected', reason: 'Strong interview' }).expect(200);
    expect(s2.body.status).toBe('Selected');
    expect((await hr.get('/api/joining/pending')).body.map((j: any) => j.applicationId)).toContain(ids.appA2);
    await change(hr, ids.appA2, { fromStatus: 'Selected', status: 'Joined' }).expect(400); // joining date required
    const s3 = await change(hr, ids.appA2, { fromStatus: 'Selected', status: 'Joined', joiningDate: '2026-12-15' }).expect(200);
    expect(s3.body.status).toBe('Joined');
    await change(hr, ids.appA2, { fromStatus: 'Joined', status: 'Not Selected', reason: 'n/a' }).expect(400);

    const a = (await hr.get(`/api/applications/${ids.appA}`)).body;
    const a2 = (await hr.get(`/api/applications/${ids.appA2}`)).body;
    expect(a2.candidateId).toBe(a.candidateId);
    expect(a.joining.joiningDate).toBe('2026-12-01');
    expect(a2.joining.joiningDate).toBe('2026-12-15');
    expect((await ds.query(`SELECT count(*)::int AS n FROM applications WHERE "candidateId" = $1`, [a.candidateId]))[0].n).toBe(2);
  });

  it('final decisions cannot skip shortlisting via the existing endpoint either', async () => {
    const failed = (await ds.query(`SELECT id FROM applications WHERE "processingStatus" = 'Failed' LIMIT 1`))[0];
    await (await as('recruiter')).post(`/api/applications/${failed.id}/final-decision`).send({ decision: 'Selected' }).expect(409);
  });

  it('status changes are audited with old/new status, user and reason', async () => {
    const audit = await (await as('admin')).get(`/api/audit?entityType=Application&entityId=${ids.appA2}&pageSize=100`).expect(200);
    const changes = audit.body.items.filter((e: any) => e.action === 'application.status_change').reverse();
    expect(changes.map((e: any) => [e.oldValues.status, e.newValues.status])).toEqual([['Pass', 'Shortlisted'], ['Shortlisted', 'Selected'], ['Selected', 'Joined']]);
    expect(changes[1]).toMatchObject({ actorName: 'HR Recruiter', newValues: { reason: 'Strong interview' } });
    expect(changes[0].createdAt).toBeTruthy();
  });

  it('CV can be previewed inline or downloaded as an attachment', async () => {
    const hr = await as('recruiter');
    const docId = (await hr.get(`/api/applications/${ids.appA}`)).body.documents[0].id;
    expect((await hr.get(`/api/documents/${docId}`).expect(200)).headers['content-disposition']).toMatch(/^inline/);
    expect((await hr.get(`/api/documents/${docId}?download=1`).expect(200)).headers['content-disposition']).toMatch(/^attachment/);
  });
});

describe('Super Admin approval is sufficient', () => {
  const pdf = Buffer.from('%PDF-1.4\n% signed approval note\n');

  it('approves a part-approved requisition in one decision, persists Approved and moves it to the HR queue', async () => {
    const req = await as('requester.ict');
    const a = (await req.post('/api/requisitions').send(validForm()).expect(201)).body.id;
    const b = (await req.post('/api/requisitions').send(validForm()).expect(201)).body.id;
    await req.post(`/api/requisitions/${a}/submit`).expect(200);
    await req.post(`/api/requisitions/${b}/submit`).expect(200);
    await (await as('director')).post(`/api/requisitions/${a}/approve`).send({}).expect(200); // step 1 by its named approver

    const admin = await as('admin');
    const inbox = (await admin.get('/api/approvals/inbox').expect(200)).body;
    expect(inbox.all.map((p: any) => p.requisition.id)).toEqual(expect.arrayContaining([a, b]));

    // Unauthorized users still cannot approve.
    await req.post(`/api/requisitions/${b}/approve`).send({}).expect(403);
    await (await as('concerned.hr')).post(`/api/requisitions/${b}/approve`).send({}).expect(403);

    const before = (await admin.get(`/api/requisitions/${a}`).expect(200)).body;
    expect(before.currentAction).toMatchObject({ stepOrder: 2, onBehalf: true });
    await admin.post(`/api/requisitions/${a}/approve`)
      .field('actionId', before.currentAction.id).field('remarks', 'Approved by Super Admin').attach('file', pdf, 'approval.pdf').expect(200);
    const again = await admin.post(`/api/requisitions/${a}/approve`).send({ actionId: before.currentAction.id }).expect(200);
    expect(again.body.duplicate).toBe(true);

    // Persisted, not just returned: a fresh query of the database and of every view agrees.
    expect((await ds.query(`SELECT status FROM requisitions WHERE id = $1`, [a]))[0].status).toBe('Sent to HR');
    const done = (await admin.get(`/api/requisitions/${a}`).expect(200)).body;
    expect(done.status).toBe('Sent to HR');
    expect(done.canAct).toBe(false);
    expect(done.approvals.map((x: any) => [x.stepOrder, x.status, x.actedBy?.name ?? null])).toEqual([
      [1, 'Approved', null], [2, 'Approved', 'System Administrator'], [3, 'Superseded', null], [4, 'Superseded', null], [5, 'Superseded', null],
    ]);
    expect(done.approvals[1].documents).toEqual([expect.objectContaining({ originalName: 'approval.pdf' })]);
    expect(done.attachments).toHaveLength(0); // decision documents are kept apart from the form attachments
    const file = await admin.get(`/api/requisitions/${a}/attachments/${done.approvals[1].documents[0].id}`).expect(200);
    expect(Buffer.from(file.body).toString('latin1')).toContain('%PDF');
    expect(await ds.query(`SELECT count(*)::int AS n FROM approval_actions WHERE "requisitionId" = $1 AND status = 'Approved'`, [a])).toEqual([{ n: 2 }]);

    expect((await (await as('hr.manager')).get('/api/hr-queue').expect(200)).body.items.map((i: any) => i.id)).toContain(a);
    const after = (await admin.get('/api/approvals/inbox').expect(200)).body;
    expect(after.all.map((p: any) => p.requisition.id)).not.toContain(a);
    expect(after.history.find((h: any) => h.requisition.id === a).requisition.status).toBe('Sent to HR');
    expect((await req.get('/api/requisitions').expect(200)).body.items.find((x: any) => x.id === a).status).toBe('Sent to HR');
    expect((await (await as('concerned.hr')).get('/api/approvals/inbox').expect(200)).body.upcoming.map((p: any) => p.requisition.id)).not.toContain(a);
    const audit = await admin.get(`/api/audit?entityType=Requisition&entityId=${a}&pageSize=50`).expect(200);
    expect(audit.body.items.find((e: any) => e.action === 'requisition.approve_final').newValues).toMatchObject({
      onBehalfOf: 'Concerned HR', document: 'approval.pdf', skippedSteps: ['Concerned AD/ED', 'Corporate HR', 'HOD-HR'],
    });

    // The other requisition is untouched.
    const other = (await admin.get(`/api/requisitions/${b}`).expect(200)).body;
    expect(other.status).toBe('Pending Approval');
    expect(other.approvals.map((x: any) => x.status)).toEqual(['Pending', 'Waiting', 'Waiting', 'Waiting', 'Waiting']);
  });

  it('a named approver can attach a document; bad files are refused; others cannot act on behalf', async () => {
    const req = await as('requester.ict');
    const r = await req.post('/api/requisitions').send(validForm()).expect(201);
    await req.post(`/api/requisitions/${r.body.id}/submit`).expect(200);
    const dir = await as('director');
    await dir.post(`/api/requisitions/${r.body.id}/approve`).attach('file', Buffer.from('not a pdf'), 'fake.pdf').expect(400);
    await (await as('concerned.hr')).post(`/api/requisitions/${r.body.id}/approve`).send({ actionId: r.body.id }).expect(409);
    await dir.post(`/api/requisitions/${r.body.id}/return`).field('reason', 'Attach the signed JD.').attach('file', pdf, 'comments.pdf').expect(200);
    const d = (await req.get(`/api/requisitions/${r.body.id}`).expect(200)).body;
    const returned = d.approvals.find((a: any) => a.status === 'Returned');
    expect(returned).toMatchObject({ actedBy: null, documents: [{ originalName: 'comments.pdf' }] });
  });
});

describe('Roles: Admin final approval', () => {
  it('one Admin approval completes the route; Admin cannot edit requisitions or open HR and configuration pages', async () => {
    const req = await as('requester.admin');
    const id = (await req.post('/api/requisitions').send({ ...validForm(), departmentId: ids.admin }).expect(201)).body.id;
    await req.post(`/api/requisitions/${id}/submit`).expect(200);
    const adm = await as('approval.admin');
    const d = (await adm.get(`/api/requisitions/${id}`).expect(200)).body;
    expect(d).toMatchObject({ canAct: true, canEdit: false, currentAction: { stepOrder: 1, onBehalf: true } });
    await adm.put(`/api/requisitions/${id}`).send(validForm()).expect(403);
    await adm.post(`/api/requisitions/${id}/approve`).send({ actionId: d.currentAction.id, remarks: 'Approved by Admin' }).expect(200);
    expect((await ds.query(`SELECT status FROM requisitions WHERE id = $1`, [id]))[0].status).toBe('Sent to HR');
    expect((await req.get('/api/requisitions').expect(200)).body.items.find((r: any) => r.id === id).status).toBe('Sent to HR');
    expect((await (await as('hr.manager')).get('/api/hr-queue').expect(200)).body.items.map((i: any) => i.id)).toContain(id);
    for (const path of ['/api/hr-queue', '/api/admin/users', '/api/vacancies', '/api/cv-bank/applications', '/api/audit']) await adm.get(path).expect(403);
    await adm.post('/api/master/departments').send({ code: 'X1', name: 'X' }).expect(403);
  });
});

describe('HR coordinator assignment and coordinator-specific access', () => {
  it('only the assigned coordinator works on a vacancy\'s CVs; other HR users are refused by the API', async () => {
    const own = await as('recruiter');
    const other = await as('recruiter2');
    const apps = (await own.get(`/api/vacancies/${ids.vacancy}/applications`).expect(200)).body.items;
    expect(apps.length).toBeGreaterThan(0);
    const appId = apps[0].id;
    const cv = (await own.get(`/api/cv-bank/applications?vacancyId=${ids.vacancy}`).expect(200)).body.items.find((r: any) => r.documentId);
    await own.get(`/api/documents/${cv.documentId}`).expect(200);

    // Unassigned HR user: nothing listed, every direct request refused.
    expect((await other.get('/api/vacancies').expect(200)).body.items).toEqual([]);
    expect((await other.get('/api/cv-bank/applications').expect(200)).body.total).toBe(0);
    expect((await other.get('/api/cv-bank/tree').expect(200)).body.departments.every((dep: any) => dep.vacancies.length === 0)).toBe(true);
    expect((await other.get('/api/joining/joined').expect(200)).body.total).toBe(0);
    expect((await other.get('/api/email/history').expect(200)).body).toEqual([]);
    for (const path of [`/api/vacancies/${ids.vacancy}`, `/api/vacancies/${ids.vacancy}/applications`, `/api/vacancies/${ids.vacancy}/evaluation`,
      `/api/applications/${appId}`, `/api/documents/${cv.documentId}`, `/api/job-posts/${ids.jobPost}`, `/api/vacancies/${ids.vacancy}/export`]) {
      await other.get(path).expect(403);
    }
    await other.post(`/api/vacancies/${ids.vacancy}/shortlist`).send({ applicationIds: [appId], shortlisted: true, reason: 'x' }).expect(403);
    await other.post(`/api/applications/${appId}/remarks`).send({ text: 'Looks good' }).expect(403);
    await other.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from(CV_C), 'sadia.txt').expect(403);
    await other.post('/api/email/preview').send({ applicationIds: [appId], kind: 'INTERVIEW_INVITE', subject: 'Hi', body: 'Hello' }).expect(403);
    await other.get('/api/intake/unmatched').expect(403);

    // HR Manager and Super Admin monitor every vacancy and coordinator.
    for (const u of ['hr.manager', 'admin']) {
      const list = (await (await as(u)).get('/api/vacancies').expect(200)).body.items;
      expect(list.find((v: any) => v.id === ids.vacancy).coordinator).toMatchObject({ name: 'HR Recruiter' });
      await (await as(u)).get(`/api/applications/${appId}`).expect(200);
    }
  });

  it('reassigning moves access to the new coordinator at once, is persisted and audited; only active HR users qualify', async () => {
    const mgr = await as('hr.manager');
    await (await as('recruiter')).put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: ids.recruiter2 }).expect(403); // HR cannot assign
    const examiner = (await ds.query(`SELECT id FROM users WHERE email = 'examiner@ars.local'`))[0].id;
    await mgr.put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: examiner }).expect(400);
    await mgr.put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: 'not-a-uuid' }).expect(400);

    const r = await mgr.put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: ids.recruiter2 }).expect(200);
    expect(r.body).toMatchObject({ changed: true, coordinator: { name: 'HR Coordinator Two' } });
    expect((await mgr.put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: ids.recruiter2 }).expect(200)).body.changed).toBe(false);
    await (await as('recruiter2')).get(`/api/vacancies/${ids.vacancy}/applications`).expect(200);
    await (await as('recruiter')).get(`/api/vacancies/${ids.vacancy}/applications`).expect(403);
    expect((await (await as('recruiter')).get('/api/vacancies').expect(200)).body.items.map((v: any) => v.id)).toEqual([ids.vacancy2]);

    // Stored on the vacancy and its requisition, so it survives refresh / re-login and shows in the queue.
    expect((await ds.query(`SELECT "coordinatorId" FROM vacancies WHERE id = $1`, [ids.vacancy]))[0].coordinatorId).toBe(ids.recruiter2);
    expect((await ds.query(`SELECT "coordinatorId" FROM requisitions WHERE id = $1`, [ids.req]))[0].coordinatorId).toBe(ids.recruiter2);
    const queue = (await mgr.get('/api/hr-queue?view=all').expect(200)).body.items;
    expect(queue.find((i: any) => i.id === ids.req).coordinator).toMatchObject({ name: 'HR Coordinator Two' });
    expect((await (await as('recruiter2')).get('/api/notifications').expect(200)).body.items.some((n: any) => n.event === 'coordinator.assigned')).toBe(true);

    const audit = (await (await as('admin')).get(`/api/audit?entityType=Vacancy&entityId=${ids.vacancy}&pageSize=50`).expect(200)).body.items;
    expect(audit.find((e: any) => e.action === 'coordinator.reassign')).toMatchObject({
      actorName: 'HR Manager', oldValues: { coordinator: 'HR Recruiter' }, newValues: { coordinator: 'HR Coordinator Two' }, createdAt: expect.any(String),
    });
    expect((await (await as('admin')).get(`/api/audit?action=coordinator.assign&pageSize=50`).expect(200)).body.items.length).toBeGreaterThan(0);

    // Clearing shows Unassigned and leaves only HR Manager / Super Admin with access.
    await mgr.put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: null }).expect(200);
    expect((await mgr.get(`/api/vacancies/${ids.vacancy}`).expect(200)).body.coordinator).toBeNull();
    await (await as('recruiter2')).get(`/api/vacancies/${ids.vacancy}`).expect(403);
  });

  it('department users see their own department\'s joined candidates without contact details', async () => {
    const ict = (await (await as('requester.ict')).get('/api/joining/joined').expect(200)).body;
    const joinedIct = (await ds.query(
      `SELECT count(*)::int AS n FROM joining_records j JOIN applications a ON a.id = j."applicationId" JOIN vacancies v ON v.id = a."vacancyId"
        WHERE j.status = 'Approved' AND v."departmentId" = $1`, [ids.ict]))[0].n;
    expect(joinedIct).toBeGreaterThan(0);
    expect(ict.total).toBe(joinedIct);
    for (const row of ict.items) expect(row).toMatchObject({ department: 'ICT', email: null, phone: null });
    expect(ict.items.map((r: any) => r.name)).toContain('Rahim Uddin');
    expect((await (await as('requester.admin')).get('/api/joining/joined').expect(200)).body.total).toBe(0);
    await (await as('requester.ict')).get('/api/joining/pending').expect(403);
    await (await as('requester.ict')).get('/api/cv-bank/applications').expect(403);
  });
});

describe('Users & Roles: per-user permissions, access scopes and templates', () => {
  const userId = async (email: string) => (await ds.query(`SELECT id FROM users WHERE email = $1`, [email]))[0].id;

  it('the permission grid places every permission code in a module', async () => {
    const m = (await (await as('admin')).get('/api/admin/permission-matrix').expect(200)).body;
    const placed = new Set(m.modules.flatMap((x: any) => [...Object.values(x.actions).flat(), ...(x.extras ?? []).map((e: any) => e.code)]));
    const all: string[] = (await (await as('admin')).get('/api/admin/permissions').expect(200)).body;
    expect(all.filter((c) => !placed.has(c))).toEqual([]);
    expect(m.scopeModules).toEqual(['dashboard', 'quotas', 'requisitions', 'joining']);
    for (const u of ['recruiter', 'approval.admin', 'hr.manager']) await (await as(u)).get('/api/admin/permission-matrix').expect(403);
  });

  it('two users with the same role can differ: allow and deny are enforced by the API and audited', async () => {
    const admin = await as('admin');
    const id = await userId('recruiter2@ars.local');
    await (await as('recruiter2')).get('/api/requisitions').expect(200);
    await admin.patch(`/api/admin/users/${id}`).send({ deniedPermissions: ['requisition.view'], extraPermissions: ['audit.view'] }).expect(200);
    await (await as('recruiter2')).get('/api/requisitions').expect(403);
    await (await as('recruiter2')).get('/api/audit').expect(200);
    await (await as('recruiter')).get('/api/requisitions').expect(200); // same role, unchanged
    await admin.patch(`/api/admin/users/${id}`).send({ deniedPermissions: [], extraPermissions: [] }).expect(200);
    await (await as('recruiter2')).get('/api/requisitions').expect(200);
    const audit = (await admin.get(`/api/audit?entityType=User&entityId=${id}&pageSize=20`).expect(200)).body.items;
    expect(audit.find((e: any) => e.newValues?.deniedPermissions?.includes('requisition.view'))).toBeTruthy();
    await admin.patch(`/api/admin/users/${id}`).send({ extraPermissions: ['not.a.permission'] }).expect(400);
  });

  it('Access Scope: custom departments widen or narrow what a user sees, checked server-side', async () => {
    const admin = await as('admin');
    const id = await userId('requester.admin@ars.local');
    const dept = await as('requester.admin');
    const ictReq = (await ds.query(`SELECT id FROM requisitions WHERE "departmentId" = $1 AND status <> 'Draft' LIMIT 1`, [ids.ict]))[0].id;
    await dept.get(`/api/requisitions/${ictReq}`).expect(403);
    await admin.patch(`/api/admin/users/${id}`).send({ departmentScopes: { requisitions: { mode: 'custom', departmentIds: [] } } }).expect(400);
    await admin.patch(`/api/admin/users/${id}`).send({
      departmentScopes: { requisitions: { mode: 'custom', departmentIds: [ids.ict, ids.admin] }, quotas: { mode: 'custom', departmentIds: [ids.ict] }, dashboard: { mode: 'all' } },
    }).expect(200);
    const list = (await dept.get('/api/requisitions').expect(200)).body.items;
    expect(list.every((r: any) => [ids.ict, ids.admin].includes(r.department.id))).toBe(true);
    expect(list.map((r: any) => r.id)).toContain(ictReq);
    await dept.get(`/api/requisitions/${ictReq}`).expect(200);
    const quotaDepts = new Set((await dept.get(`/api/master/quotas?departmentId=${ids.admin}`).expect(200)).body.map((q: any) => q.departmentId));
    expect([...quotaDepts]).toEqual([ids.ict]); // the custom list replaces the own department; a filter cannot widen it
    await dept.post('/api/master/quotas').send({ companyId: ids.ho, departmentId: ids.admin, approvedQuota: 1 }).expect(403);
    expect((await dept.get('/api/dashboard').expect(200)).body.department.name).toBeNull(); // dashboard: all departments
    const me = (await dept.get('/api/auth/me').expect(200)).body;
    expect(me.scopes).toMatchObject({ dashboard: null, quotas: [ids.ict] });
    expect(new Set(me.scopes.requisitions)).toEqual(new Set([ids.ict, ids.admin]));

    // HR normally sees every department's requisitions; "Own Department Only" narrows that for one user.
    const hrId = await userId('recruiter2@ars.local');
    await admin.patch(`/api/admin/users/${hrId}`).send({ departmentScopes: { requisitions: { mode: 'own' } } }).expect(200);
    expect((await (await as('recruiter2')).get('/api/requisitions').expect(200)).body.items.map((r: any) => r.id)).not.toContain(ictReq);
    await admin.patch(`/api/admin/users/${hrId}`).send({ departmentScopes: {} }).expect(200);
    expect((await (await as('recruiter2')).get('/api/requisitions').expect(200)).body.items.map((r: any) => r.id)).toContain(ictReq);
    await admin.patch(`/api/admin/users/${id}`).send({ departmentScopes: {} }).expect(200);
    await dept.get(`/api/requisitions/${ictReq}`).expect(403);
  });

  it('permission templates are saved sets with unique names; changes are audited', async () => {
    const admin = await as('admin');
    const seeded = (await admin.get('/api/admin/permission-templates').expect(200)).body;
    expect(seeded.map((t: any) => t.name)).toEqual(expect.arrayContaining(['HR Coordinator', 'Department User - view only', 'Requisition Approver']));
    const body = { name: 'Quota clerk', description: 'Quotas of two departments', permissions: ['quota.view', 'quota.edit'], departmentScopes: { quotas: { mode: 'custom', departmentIds: [ids.ict, ids.admin] } } };
    const t = (await admin.post('/api/admin/permission-templates').send(body).expect(201)).body;
    expect(t.departmentScopes.quotas.departmentIds).toHaveLength(2);
    await admin.post('/api/admin/permission-templates').send(body).expect(409);
    await admin.post('/api/admin/permission-templates').send({ ...body, name: 'Bad', permissions: ['nope'] }).expect(400);
    await admin.put(`/api/admin/permission-templates/${t.id}`).send({ ...body, permissions: ['quota.view'] }).expect(200);
    await admin.delete(`/api/admin/permission-templates/${t.id}`).expect(200);
    const audit = (await admin.get(`/api/audit?entityType=PermissionTemplate&entityId=${t.id}&pageSize=10`).expect(200)).body.items.map((e: any) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['permission_template.create', 'permission_template.update', 'permission_template.delete']));
  });

  it('roles can be created and edited; an administrator cannot lock themselves out', async () => {
    const admin = await as('admin');
    const role = (await admin.post('/api/admin/roles').send({ code: 'HR_ASSISTANT', name: 'HR Assistant', permissions: ['vacancy.view', 'candidate.view'] }).expect(201)).body;
    await admin.post('/api/admin/roles').send({ code: 'HR_ASSISTANT', name: 'Again', permissions: [] }).expect(400);
    await admin.patch(`/api/admin/roles/${role.id}`).send({ permissions: ['vacancy.view'] }).expect(200);
    const superRole = (await admin.get('/api/admin/roles').expect(200)).body.find((r: any) => r.code === 'SUPER_ADMIN');
    await admin.patch(`/api/admin/roles/${superRole.id}`).send({ active: false }).expect(400);
    const me = await userId('admin@ars.local');
    await admin.patch(`/api/admin/users/${me}`).send({ deniedPermissions: ['admin.users'] }).expect(400);
    await admin.patch(`/api/admin/users/${me}`).send({ active: false }).expect(400);
    await admin.get('/api/admin/users').expect(200);
  });
});

describe('Users & Roles: delete, restore and permission settings', () => {
  const login = (email: string) => request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'TempPass#2026' });
  const userId = async (email: string) => (await ds.query(`SELECT id FROM users WHERE email = $1 AND "deletedAt" IS NULL`, [email]))[0].id;

  it('deleting a user hides it and blocks sign-in but keeps history; restore brings it back inactive', async () => {
    const admin = await as('admin');
    const u = (await admin.post('/api/admin/users').send({ name: 'Temp Person', email: 'temp.person@ars.local', password: 'TempPass#2026', roleCodes: ['DEPT_REQUESTER'], departmentId: ids.ict }).expect(201)).body;
    await login('temp.person@ars.local').expect(200);
    await admin.delete(`/api/admin/users/${u.id}`).expect(200);
    expect((await admin.get('/api/admin/users').expect(200)).body.map((x: any) => x.id)).not.toContain(u.id);
    expect((await admin.get('/api/admin/users?deleted=true').expect(200)).body.find((x: any) => x.id === u.id)).toMatchObject({ active: false, deletedAt: expect.any(String) });
    await login('temp.person@ars.local').expect(401);
    await admin.patch(`/api/admin/users/${u.id}`).send({ name: 'Renamed' }).expect(404);
    await admin.delete(`/api/admin/users/${u.id}`).expect(404);
    expect((await ds.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [u.id]))[0].n).toBe(1); // row kept for history

    // The email is free again; restoring the old account is refused while it is taken.
    const again = (await admin.post('/api/admin/users').send({ name: 'Temp Person 2', email: 'temp.person@ars.local', password: 'TempPass#2026', roleCodes: [] }).expect(201)).body;
    await admin.post(`/api/admin/users/${u.id}/restore`).expect(409);
    await admin.delete(`/api/admin/users/${again.id}`).expect(200);
    const restored = (await admin.post(`/api/admin/users/${u.id}/restore`).expect(200)).body;
    expect(restored).toMatchObject({ id: u.id, active: false });
    await login('temp.person@ars.local').expect(401); // inactive until an administrator activates it
    await admin.patch(`/api/admin/users/${u.id}`).send({ active: true }).expect(200);
    await login('temp.person@ars.local').expect(200);
    const audit = (await admin.get(`/api/audit?entityType=User&entityId=${u.id}&pageSize=20`).expect(200)).body.items.map((e: any) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['user.create', 'user.delete', 'user.restore']));
  });

  it('a user with work still assigned, or yourself, cannot be deleted', async () => {
    const admin = await as('admin');
    await admin.delete(`/api/admin/users/${await userId('admin@ars.local')}`).expect(400);
    const route = await admin.delete(`/api/admin/users/${await userId('director@ars.local')}`).expect(409);
    expect(route.body.message).toMatch(/approval route/);
    await (await as('hr.manager')).put(`/api/vacancies/${ids.vacancy}/coordinator`).send({ coordinatorId: ids.recruiter }).expect(200); // an open vacancy
    const coord = await admin.delete(`/api/admin/users/${await userId('recruiter@ars.local')}`).expect(409);
    expect(coord.body.message).toMatch(/coordinator/);
    await (await as('hr.manager')).delete(`/api/admin/users/${await userId('viewer@ars.local')}`).expect(403);
  });

  it('custom roles can be deleted once unused; built-in roles cannot', async () => {
    const admin = await as('admin');
    const roles = (await admin.get('/api/admin/roles').expect(200)).body;
    const builtIn = roles.find((r: any) => r.code === 'DEPT_REQUESTER');
    expect(builtIn.builtIn).toBe(true);
    await admin.delete(`/api/admin/roles/${builtIn.id}`).expect(400);
    const role = (await admin.post('/api/admin/roles').send({ code: 'TEMP_ROLE', name: 'Temp role', permissions: ['vacancy.view'] }).expect(201)).body;
    const uid = await userId('temp.person@ars.local');
    await admin.patch(`/api/admin/users/${uid}`).send({ roleCodes: ['TEMP_ROLE'] }).expect(200);
    await admin.delete(`/api/admin/roles/${role.id}`).expect(409);
    await admin.patch(`/api/admin/users/${uid}`).send({ roleCodes: [] }).expect(200);
    await admin.delete(`/api/admin/roles/${role.id}`).expect(200);
    expect((await admin.get('/api/admin/roles').expect(200)).body.map((r: any) => r.code)).not.toContain('TEMP_ROLE');
  });

  it('permissions can be renamed, described and switched off system-wide, then reset', async () => {
    const admin = await as('admin');
    const hr = await as('hr.manager');
    await hr.get('/api/audit').expect(200);
    await admin.put('/api/admin/permission-settings/permission/audit.view').send({ label: 'Read the audit trail', description: 'Who changed what', disabled: true }).expect(200);
    await hr.get('/api/audit').expect(403); // off for everyone, whatever their role says
    const m = (await admin.get('/api/admin/permission-matrix').expect(200)).body;
    expect(m.permissions['audit.view']).toEqual({ label: 'Read the audit trail', description: 'Who changed what', disabled: true });
    await admin.put('/api/admin/permission-settings/module/candidates').send({ label: 'CV Bank', description: 'Candidate records' }).expect(200);
    expect((await admin.get('/api/admin/permission-matrix').expect(200)).body.modules.find((x: any) => x.key === 'candidates'))
      .toMatchObject({ label: 'CV Bank', defaultLabel: 'Candidates (CV Bank)', description: 'Candidate records' });
    await admin.put('/api/admin/permission-settings/permission/admin.users').send({ disabled: true }).expect(400);
    await admin.put('/api/admin/permission-settings/permission/no.such.code').send({ label: 'x' }).expect(404);
    await admin.put('/api/admin/permission-settings/group/candidates').send({ label: 'x' }).expect(400);
    await admin.delete('/api/admin/permission-settings/permission/audit.view').expect(200);
    await admin.delete('/api/admin/permission-settings/module/candidates').expect(200);
    await hr.get('/api/audit').expect(200);
    expect((await admin.get('/api/admin/permission-matrix').expect(200)).body.modules.find((x: any) => x.key === 'candidates').label).toBe('Candidates (CV Bank)');
  });
});

describe('Hiring circular: generated PDF and plain text', () => {
  it('a job post produces a downloadable poster PDF and text version from its details', async () => {
    const mgr = await as('hr.manager');
    const jp = (await mgr.get(`/api/job-posts/${ids.jobPost}`).expect(200)).body;
    await mgr.put(`/api/job-posts/${ids.jobPost}`).send({
      title: jp.title, description: 'Join our ICT team to build internal systems.',
      duties: '- Develop internal applications\n2. Support users and troubleshoot issues', skills: 'TypeScript\nNetworking basics',
      education: 'B.Sc in CSE', experienceRequirement: '1-3 years', location: 'Head Office, Uttara, Dhaka', employmentType: 'Full-time',
      salary: 'Negotiable', emailSubject: 'Application for Software Developer',
    }).expect(200);
    await mgr.put(`/api/job-posts/${ids.jobPost}`).send({ title: jp.title, applyEmail: 'not-an-email' }).expect(400);

    const pdf = await mgr.get(`/api/job-posts/${ids.jobPost}/circular-file?format=pdf&download=1`).buffer(true)
      .parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^attachment; filename=".*\.pdf"$/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const txt = await mgr.get(`/api/job-posts/${ids.jobPost}/circular-file?format=txt`).expect(200);
    expect(txt.headers['content-type']).toMatch(/^text\/plain/);
    expect(txt.text).toContain(jp.title);
    expect(txt.text).toContain('• Develop internal applications'); // typed bullets / numbering are normalised
    expect(txt.text).toContain('• Support users and troubleshoot issues');
    expect(txt.text).toContain('Location: Head Office, Uttara, Dhaka');
    expect(txt.text).toContain('Salary: Negotiable');
    expect(txt.text).toContain('Send your CV to: career@ananta.com.bd');
    expect(txt.text).toContain(`Email subject: Application for Software Developer (${jp.jobNo})`); // job ID routes emailed CVs
    expect(txt.text).not.toContain('[DRAFT');

    await mgr.get(`/api/job-posts/${ids.jobPost}/circular-file?format=docx`).expect(400);
    await (await as('recruiter2')).get(`/api/job-posts/${ids.jobPost}/circular-file?format=pdf`).expect(403); // not their vacancy
    await (await as('requester.ict')).get(`/api/job-posts/${ids.jobPost}/circular-file?format=txt`).expect(403);
  });
});

describe('Direct HR vacancy: coordinator chosen at creation', () => {
  const body = () => ({ departmentId: ids.ict, companyId: ids.ho, positionTitle: 'Network Engineer', headcount: 1, vacancyType: 'NEW', directReason: 'Urgent network project approved' });

  it('HR Manager can choose the coordinator; access, audit and notification follow', async () => {
    const mgr = await as('hr.manager');
    const v = (await mgr.post('/api/vacancies/direct').send({ ...body(), coordinatorId: ids.recruiter2 }).expect(201)).body;
    expect(v).toMatchObject({ source: 'DIRECT_HR', coordinatorId: ids.recruiter2 });
    await (await as('recruiter2')).get(`/api/vacancies/${v.id}`).expect(200);
    await (await as('recruiter')).get(`/api/vacancies/${v.id}`).expect(403);
    expect((await mgr.get('/api/vacancies').expect(200)).body.items.find((x: any) => x.id === v.id).coordinator).toMatchObject({ name: 'HR Coordinator Two' });
    const audit = (await (await as('admin')).get(`/api/audit?entityType=Vacancy&entityId=${v.id}&pageSize=20`).expect(200)).body.items;
    expect(audit.find((e: any) => e.action === 'coordinator.assign')).toMatchObject({
      actorName: 'HR Manager', oldValues: { coordinator: null }, newValues: { coordinator: 'HR Coordinator Two' },
    });
    const notes = (await (await as('recruiter2')).get('/api/notifications').expect(200)).body.items;
    expect(notes.some((n: any) => n.event === 'coordinator.assigned' && n.link === `/vacancies/${v.id}`)).toBe(true);
  });

  it('a coordinator is optional, must be an active HR user and needs the assign permission', async () => {
    const mgr = await as('hr.manager');
    const v = (await mgr.post('/api/vacancies/direct').send(body()).expect(201)).body;
    expect(v.coordinatorId).toBeNull();
    const examiner = (await ds.query(`SELECT id FROM users WHERE email = 'examiner@ars.local'`))[0].id;
    await mgr.post('/api/vacancies/direct').send({ ...body(), coordinatorId: examiner }).expect(400);

    // May create direct vacancies but not assign coordinators: refused with one, allowed without.
    const admin = await as('admin');
    await admin.patch(`/api/admin/users/${ids.recruiter2}`).send({ extraPermissions: ['vacancy.create_direct'] }).expect(200);
    const hr = await as('recruiter2');
    await hr.post('/api/vacancies/direct').send({ ...body(), coordinatorId: ids.recruiter2 }).expect(403);
    await hr.post('/api/vacancies/direct').send(body()).expect(201);
    await admin.patch(`/api/admin/users/${ids.recruiter2}`).send({ extraPermissions: [] }).expect(200);
  });
});
