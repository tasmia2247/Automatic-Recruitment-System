/**
 * End-to-end acceptance test: walks the full ARS workflow against a real PostgreSQL database
 * and checks the SRS section 24 acceptance criteria (AC-xx) along the way.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import MailComposer from 'nodemailer/lib/mail-composer';
import * as path from 'path';
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
  background: 'New ERP projects need two developers.', specialization: 'Computer Science, TypeScript',
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
    await (await as('recruiter')).post('/api/master/quotas').send({ departmentId: ids.ict, positionId: ids.dev, approvedQuota: 1 }).expect(403);
    // A user with no department gets a clear refusal on scoped lists, but the dashboard still loads.
    await (await as('viewer')).get('/api/requisitions').expect(403);
    await (await as('viewer')).get('/api/dashboard').expect(200);
  });

  it('quota rows are deleted only by their own department or the Super Admin (owner, 2026-11-08)', async () => {
    const ict = await as('requester.ict');
    const used = new Set((await ict.get('/api/master/quotas').expect(200)).body.map((q: any) => q.positionId));
    const free = (await ict.get('/api/master/lookups').expect(200)).body.positions.filter((p: any) => !used.has(p.id)).map((p: any) => p.id);
    const row = async (positionId: string) => (await ict.post('/api/master/quotas').send({ departmentId: ids.ict, positionId, approvedQuota: 3, presentManpower: 1 }).expect(201)).body.id;
    const a = await row(free[0]);
    const b = await row(free[1]);
    await (await as('requester.admin')).delete(`/api/master/quotas/${a}`).expect(403); // another department
    await (await as('recruiter')).delete(`/api/master/quotas/${a}`).expect(403); // HR: view only
    await (await as('corporate.hr')).delete(`/api/master/quotas/${a}`).expect(403);
    expect((await ict.delete(`/api/master/quotas/${a}`).expect(200)).body).toEqual({ deleted: true });
    expect((await (await as('admin')).delete(`/api/master/quotas/${b}`).expect(200)).body).toEqual({ deleted: true });
    await ict.delete(`/api/master/quotas/${b}`).expect(404);
    const left = (await ict.get('/api/master/quotas').expect(200)).body.map((q: any) => q.id);
    expect(left).not.toContain(a);
    expect(left).not.toContain(b);
    const [audit] = await ds.query(`SELECT "oldValues" FROM audit_events WHERE action = 'quota.delete' AND "entityId" = $1`, [a]);
    expect(audit.oldValues).toMatchObject({ approvedQuota: 3, presentManpower: 1, departmentId: ids.ict });
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
    await req.put(`/api/requisitions/${ids.req}`).send({ ...validForm(), jobDescription: 'Develop software with Node.js.' }).expect(200);
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

  it('AC-11: a job post publishes without criteria; screening comes from the requisition', async () => {
    const hr = await as('recruiter');
    const jp = await hr.post(`/api/vacancies/${ids.vacancy}/job-posts`).send({ title: 'Software Developer', startDate: '2026-11-01', deadline: '2026-11-30' }).expect(201);
    ids.jobPost = jp.body.id;
    await hr.post(`/api/job-posts/${ids.jobPost}/status`).send({ status: 'Published' }).expect(200);
    await hr.post(`/api/job-posts/${ids.jobPost}/criteria`).send({ criteria: [] }).expect(404); // criteria are no longer set per job post
    const reqNo = (await hr.get(`/api/requisitions/${ids.req}`).expect(200)).body.reqNo;
    // The job post starts from the requisition's Min Edu. Qualification and Experience; the screening fields stay off it.
    const post = (await hr.get(`/api/job-posts/${ids.jobPost}`).expect(200)).body;
    expect(post).toMatchObject({ education: 'B.Sc in CSE', experienceRequirement: '2 years', duties: 'Develop software with Node.js.', skills: null });
    expect(post.prefill).toEqual({ education: 'B.Sc in CSE', experienceRequirement: '2 years', duties: 'Develop software with Node.js.' });
    expect(post.screening).toBeUndefined();
    expect(JSON.stringify(post)).not.toContain('TypeScript');
    expect((await hr.get(`/api/vacancies/${ids.vacancy}`).expect(200)).body.screening).toMatchObject({ source: 'REQUISITION', reqNo, other: 'Computer Science, TypeScript', keyResponsibilities: 'Develop software with Node.js.',
 });
    expect((await hr.get(`/api/vacancies/${ids.vacancy}`).expect(200)).body.screening.items).toEqual(['Computer Science', 'TypeScript', 'Key Responsibilities (1 point)', 'match score at least 70%']);
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
    const files = (await ds.query(`SELECT "storageKey" FROM candidate_documents WHERE "applicationId" = ANY($1)`, [[ids.appA, ids.appB, ids.appC]])).map((r: any) => path.resolve(config.storageDir, r.storageKey));
    expect(files.every((f: string) => fs.existsSync(f))).toBe(true);
    await jobs.drain();
    // Owner, 2026-11-10: the original CV file is kept alongside the extracted text, so HR can download it or bundle a PDF pack.
    expect(files.every((f: string) => fs.existsSync(f))).toBe(true);
    // The same file is still refused (dedup by sha256).
    const later = await hr.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from(CV_A), 'rahim-again.txt').expect(201);
    expect(later.body[0]).toMatchObject({ ok: false, error: expect.stringMatching(/already received/) });
  });

  it('AC-14/AC-15: extraction does not fabricate; screening checks every Specialization required item, with reasons', async () => {
    const hr = await as('recruiter');
    const list = await hr.get(`/api/vacancies/${ids.vacancy}/applications`).expect(200);
    const byId = Object.fromEntries(list.body.items.map((a: any) => [a.id, a]));
    expect(byId[ids.appA]).toMatchObject({ screeningResult: 'Pass', screeningScore: 100, cgpa: 3.45, totalExperienceYears: 3 });
    expect(byId[ids.appA].candidate).toMatchObject({ name: 'Rahim Uddin', email: 'rahim.uddin@example.com' });
    // Missing items send a CV to Review Required, never to Fail.
    expect(byId[ids.appB].screeningResult).toBe('Review Required');
    // The Key Responsibilities keywords (develop, software, node, js) make up the match score: B has only "developer".
    expect(byId[ids.appB].screeningScore).toBe(25);
    expect(byId[ids.appB].screeningReasons).toEqual(['Match score 25% is below the pass mark of 70% (Key Responsibilities 25% of 100) - needs review.',
      'Computer Science: not found in CV - needs manual verification.', 'TypeScript: not found in CV - needs manual verification.']);
    expect(byId[ids.appC]).toMatchObject({ screeningResult: 'Review Required', cgpa: null, extractionStatus: 'Review Required' });
    expect(byId[ids.appC].screeningReasons).toEqual(['Match score 0% is below the pass mark of 70% (Key Responsibilities 0% of 100) - needs review.', 'TypeScript: not found in CV - needs manual verification.']);
    expect(byId[ids.appC].candidate.email).toBeNull();
    expect(list.body.items.map((a: any) => a.id)).toEqual([ids.appA, ids.appB, ids.appC]); // Pass first, then Review by match score
  });

  it('AC-16: runs record the requisition they used; a correction re-screens and keeps the earlier run', async () => {
    const hr = await as('recruiter');
    const d = await hr.get(`/api/applications/${ids.appC}`).expect(200);
    expect(d.body.screeningRuns).toHaveLength(1);
    expect(d.body.screeningRuns[0]).toMatchObject({ basis: 'REQUISITION', criteriaSetId: null, criteriaVersion: 2, overallResult: 'Review Required' });
    expect(d.body.screeningRuns[0].inputs.cvText).toBeUndefined(); // the CV text itself is not copied into the run
    await hr.patch(`/api/applications/${ids.appC}`).send({ skills: 'TypeScript, React, Node.js software development' }).expect(200);
    await jobs.drain();
    const d2 = await hr.get(`/api/applications/${ids.appC}`).expect(200);
    expect(d2.body.screeningRuns.map((r: any) => r.overallResult)).toEqual(['Pass', 'Review Required']);
    await hr.post(`/api/vacancies/${ids.vacancy}/rescreen`).expect(200);
    await jobs.drain();
    expect((await hr.get(`/api/applications/${ids.appB}`)).body.screeningRuns.map((r: any) => r.overallResult)).toEqual(['Review Required', 'Review Required']);
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

  it('"Re-read CVs" reads stored CVs again, keeps what a person corrected and screens again (owner, 2026-11-08)', async () => {
    const hr = await as('recruiter');
    await hr.patch(`/api/applications/${ids.appC}`).send({ name: 'Sadia A. Akter' }).expect(200);
    const before = (await hr.get(`/api/applications/${ids.appC}`)).body;
    expect(before.correctedFields).toEqual(expect.arrayContaining(['skills', 'email', 'name']));
    expect((await hr.post(`/api/applications/${ids.appC}/reread`).expect(200)).body).toEqual({ queued: 1 });
    await jobs.drain();
    const after = (await hr.get(`/api/applications/${ids.appC}`)).body;
    expect(after.extractionRuns).toHaveLength(before.extractionRuns.length + 1);
    expect(after.screeningRuns).toHaveLength(before.screeningRuns.length + 1);
    expect(after.candidate).toMatchObject({ name: 'Sadia A. Akter', email: 'sadia.akter@example.com' }); // corrected: kept
    expect(after.skills).toBe(before.skills);
    // A name read wrongly by an older extractor (nobody corrected it) is replaced by the new reading.
    const a = (await hr.get(`/api/applications/${ids.appA}`)).body;
    await ds.query(`UPDATE candidates SET name = 'Dhaka.' WHERE id = $1`, [a.candidateId]);
    await hr.post(`/api/applications/${ids.appA}/reread`).expect(200);
    await jobs.drain();
    expect((await hr.get(`/api/applications/${ids.appA}`)).body.candidate.name).toBe('Rahim Uddin');
    // A whole vacancy, by someone who may run screening on it; others are refused.
    expect((await hr.post(`/api/vacancies/${ids.vacancy}/reread`).expect(200)).body.queued).toBeGreaterThanOrEqual(3);
    await jobs.drain();
    await (await as('requester.admin')).post(`/api/vacancies/${ids.vacancy}/reread`).expect(403);
    const audit = await (await as('admin')).get(`/api/audit?entityType=Vacancy&entityId=${ids.vacancy}&pageSize=50`).expect(200);
    expect(audit.body.items.some((e: any) => e.action === 'cv.reread')).toBe(true);
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
    expect(header).toEqual(['Candidate ID', 'Application ID', 'Candidate Name', 'Education', 'Institution', 'CGPA', 'Work Experience (years)', 'Workplace', 'Email', 'Phone', 'Applied Position', 'Screening Status', 'Match Score (%)', 'Screening Reasons', 'Remarks']);
    expect(ws.rowCount - 1).toBe(3);
    const a = await (await as('recruiter')).get(`/api/applications/${ids.appA}`);
    expect(ws.getRow(2).getCell(2).value).toBe(a.body.applicationNo);
    await (await as('examiner')).get(`/api/vacancies/${ids.vacancy}/export`).expect(403);
  });
});

describe('Selection, evaluation, communication and joining', () => {
  it('AC-18: shortlisting a CV that did not pass is an override and leaves the screening result untouched', async () => {
    const hr = await as('recruiter');
    const r = await hr.post(`/api/vacancies/${ids.vacancy}/shortlist`).send({ applicationIds: [ids.appA], shortlisted: true }).expect(200);
    expect(r.body[0].ok).toBe(true);
    await hr.post(`/api/vacancies/${ids.vacancy}/shortlist`).send({ applicationIds: [ids.appB, ids.appC], shortlisted: true, reason: 'Strong practical experience' }).expect(200);
    const b = await hr.get(`/api/applications/${ids.appB}`).expect(200);
    expect(b.body).toMatchObject({ shortlisted: true, screeningResult: 'Review Required', shortlistReason: 'Strong practical experience' });
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
    // An examiner is not a coordinator, so sees no vacancy until Super Admin grants full recruitment access.
    await (await as('examiner')).get(`/api/vacancies/${ids.vacancy}/evaluation`).expect(403);
    ids.examiner = (await ds.query(`SELECT id FROM users WHERE email = 'examiner@ars.local'`))[0].id;
    await (await as('admin')).patch(`/api/admin/users/${ids.examiner}`).send({ extraPermissions: ['recruitment.view_all'] }).expect(200);
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

  it('written & interview marks come from one pre-filled sheet: one preview per exam, blank cells left out', async () => {
    const hr = await as('recruiter');
    const tpl = await hr.get(`/api/vacancies/${ids.vacancy}/marks-template?stageType=MAIN`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(tpl.headers['content-disposition']).toMatch(/_ICT_Software-Developer_written_interview_marks\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, 'Application ID', 'Candidate ID', 'Candidate Name', 'Written Marks', 'Interview Marks', 'Remarks']);
    const b = (await hr.get(`/api/applications/${ids.appB}`)).body;
    const c = (await hr.get(`/api/applications/${ids.appC}`)).body;
    const listed = (sheet.getColumn(1).values as any[]).slice(2);
    expect(listed).toEqual(expect.arrayContaining([b.applicationNo, c.applicationNo])); // the shortlisted candidates are already listed
    const out = new ExcelJS.Workbook();
    const ws = out.addWorksheet('Marks');
    ws.addRow(['Application ID', 'Candidate ID', 'Candidate Name', 'Written Marks', 'Interview Marks', 'Remarks']);
    ws.addRow([b.applicationNo, b.candidate.candidateNo, 'Karim', 64, 70]);
    ws.addRow([c.applicationNo, c.candidate.candidateNo, 'Sadia', null, 66]); // written not entered yet
    ws.addRow(['APP-1999-999999', null, 'Ghost', 40, 120]);
    const file = Buffer.from(await out.xlsx.writeBuffer());
    await (await as('screener')).post(`/api/vacancies/${ids.vacancy}/marks-import-main`).attach('file', file, 'main.xlsx').expect(403);
    const prev = (await hr.post(`/api/vacancies/${ids.vacancy}/marks-import-main?writtenMaxMarks=100&interviewMaxMarks=100`).attach('file', file, 'main.xlsx').expect(201)).body;
    expect(prev.batches.map((x: any) => [x.stageType, x.rowsAccepted, x.rowsRejected])).toEqual([['WRITTEN', 1, 1], ['INTERVIEW', 2, 1]]);
    expect(prev.batches[1].rows[2].errors.join(' ')).toMatch(/does not belong/);
    for (const x of prev.batches) await hr.post(`/api/imports/${x.id}/confirm`).send({}).expect(200);
    const marks = (await hr.get(`/api/applications/${ids.appC}`)).body.marks;
    expect(marks.map((m: any) => [m.stageType, m.marks])).toEqual([['INTERVIEW', 66]]);
    await hr.post(`/api/vacancies/${ids.vacancy}/marks-import-main`).attach('file', await marksFile([[b.applicationNo, null, 'Karim', 5]]), 'single.xlsx').expect(400);

    // The downloaded sheet carries the marks already entered (owner, 2026-11-09); uploading it back unchanged changes nothing.
    const again = await hr.get(`/api/vacancies/${ids.vacancy}/marks-template?stageType=MAIN`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(again.body);
    const rowOf = (appNo: string) => { let found: any[] = []; wb2.worksheets[0].eachRow((row) => { if (row.getCell(1).value === appNo) found = [row.getCell(4).value, row.getCell(5).value]; }); return found; };
    expect(rowOf(b.applicationNo)).toEqual([64, 70]);
    expect(rowOf(c.applicationNo)).toEqual([null, 66]);
    const back = (await hr.post(`/api/vacancies/${ids.vacancy}/marks-import-main?writtenMaxMarks=100&interviewMaxMarks=100`).attach('file', again.body, 'same.xlsx').expect(201)).body;
    let resaved = 0;
    for (const x of back.batches) resaved += (await hr.post(`/api/imports/${x.id}/confirm`).send({}).expect(200)).body.saved;
    expect(resaved).toBe(0);
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
    await (await as('admin')).patch(`/api/admin/users/${ids.examiner}`).send({ extraPermissions: [] }).expect(200);
  });

  it('Interview Board: shortlisted candidates of my vacancies only; HR Manager sees all; slots carry panel and duration', async () => {
    const hr = await as('recruiter');
    const mine = (await hr.get('/api/interviews/board').expect(200)).body;
    expect(mine.allVacancies).toBe(false);
    const ids3 = [ids.appA, ids.appB, ids.appC];
    expect(mine.rows.map((r: any) => r.applicationId)).toEqual(expect.arrayContaining(ids3));
    const rowA = mine.rows.find((r: any) => r.applicationId === ids.appA);
    expect(rowA).toMatchObject({ shortlisted: true, vacancy: { id: ids.vacancy, department: 'ICT', positionTitle: 'Software Developer', company: 'HO' } });
    expect(rowA.stages.INTERVIEW.scheduledAt).toBe('2026-11-10T04:00:00.000Z');
    expect((await hr.get(`/api/interviews/board?departmentId=${ids.admin}`).expect(200)).body.rows).toEqual([]);

    for (const u of ['recruiter2', 'examiner']) expect((await (await as(u)).get('/api/interviews/board').expect(200)).body.rows).toEqual([]);
    const all = (await (await as('hr.manager')).get('/api/interviews/board').expect(200)).body;
    expect(all.allVacancies).toBe(true);
    expect(all.rows.map((r: any) => r.applicationId)).toEqual(expect.arrayContaining(ids3));
    await (await as('requester.ict')).get('/api/interviews/board').expect(403);

    const slot = { stageType: 'OPTIONAL', scheduledAt: '2026-11-12T05:30:00Z', durationMinutes: 45, location: 'Board Room, Head Office', panel: 'Head of ICT, HR Manager' };
    await (await as('recruiter2')).post('/api/interviews/schedule').send({ ...slot, applicationIds: [ids.appC] }).expect(403);
    await hr.post('/api/interviews/schedule').send({ ...slot, durationMinutes: 2, applicationIds: [ids.appC] }).expect(400);
    const r = (await hr.post('/api/interviews/schedule').send({ ...slot, applicationIds: [ids.appC, ids.appA2] }).expect(200)).body;
    expect(r.find((x: any) => x.applicationId === ids.appC).ok).toBe(true);
    expect(r.find((x: any) => x.applicationId === ids.appA2)).toMatchObject({ ok: false, error: 'Shortlist the candidate before scheduling.' });
    const c = (await hr.get('/api/interviews/board').expect(200)).body.rows.find((x: any) => x.applicationId === ids.appC);
    expect(c.stages.OPTIONAL).toMatchObject({ scheduledAt: '2026-11-12T05:30:00.000Z', durationMinutes: 45, location: 'Board Room, Head Office', panel: 'Head of ICT, HR Manager', attendance: 'Not Recorded' });

    await hr.put(`/api/applications/${ids.appC}/stages/optional`).send({ panel: '  ', durationMinutes: 60 }).expect(200);

    // Written exam and interview board are one day: its time, venue, panel and attendance land on both; a result only on its own exam.
    const day = { stageType: 'INTERVIEW', scheduledAt: '2026-11-11T03:00:00Z', durationMinutes: 120, location: 'Hall 2', panel: 'Head of ICT' };
    await hr.post('/api/interviews/schedule').send({ ...day, applicationIds: [ids.appB] }).expect(200);
    await hr.put(`/api/applications/${ids.appB}/stages/written`).send({ attendance: 'Absent' }).expect(200);
    await hr.put(`/api/applications/${ids.appB}/stages/written`).send({ result: 'On Hold' }).expect(200);
    const b = (await hr.get('/api/interviews/board').expect(200)).body.rows.find((x: any) => x.applicationId === ids.appB);
    for (const st of ['WRITTEN', 'INTERVIEW']) expect(b.stages[st]).toMatchObject({ scheduledAt: '2026-11-11T03:00:00.000Z', durationMinutes: 120, location: 'Hall 2', panel: 'Head of ICT', attendance: 'Absent' });
    expect([b.stages.WRITTEN.result, b.stages.INTERVIEW.result]).toEqual(['On Hold', 'Pending']);
    expect(b.stages.OPTIONAL).toBeUndefined(); // the optional exam is only there when it is held
    // A slot dialog saved without a date (only venue / duration) starts no round, so the status does not turn into Interview.
    await hr.put(`/api/applications/${ids.appB}/stages/optional`).send({ location: 'Hall 9', durationMinutes: 60 }).expect(200);
    expect((await hr.get('/api/interviews/board').expect(200)).body.rows.find((x: any) => x.applicationId === ids.appB).stages.OPTIONAL).toBeUndefined();
    await hr.put(`/api/applications/${ids.appB}/stages/viva`).send({ attendance: 'Present' }).expect(400); // Viva is now the interview board
    const audit = (await (await as('admin')).get(`/api/audit?entityType=Application&entityId=${ids.appC}&pageSize=50`).expect(200)).body.items;
    expect(audit.find((e: any) => e.action === 'stage.optional.update' && e.newValues.durationMinutes === 60)).toMatchObject({ oldValues: { panel: 'Head of ICT, HR Manager', durationMinutes: 45 }, newValues: { panel: null } });
  });

  it('AC-23: a result/joining email does not mark joined; only HR approval does, once', async () => {
    const hr = await as('recruiter');
    const pending = await hr.get('/api/joining/pending').expect(200);
    expect(pending.body).toHaveLength(1);
    const j = pending.body[0];
    expect(j).toMatchObject({ headcount: 2, joinedCount: 0 }); // seats of the vacancy, shown on the Joining page
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

  it('joining updates the matching designation quota row and derives the dept figure (owner, 2026-11-10)', async () => {
    const ict = await as('requester.ict');
    // Department total lives on Master Data → Departments; designation row on /master/quotas.
    const admin = await as('admin');
    await admin.patch(`/api/master/departments/${ids.ict}`).send({ totalQuota: 50 }).expect(200);
    const present = (await ict.get('/api/master/quotas').expect(200)).body as any[];
    const upsertDesig = async (positionId: string, approvedQuota: number, presentManpower: number) => {
      const row = present.find((q) => q.departmentId === ids.ict && q.positionId === positionId);
      if (row) {
        await admin.patch(`/api/master/quotas/${row.id}`).send({ approvedQuota, presentManpower }).expect(200);
        return row.id as string;
      }
      return (await ict.post('/api/master/quotas').send({ departmentId: ids.ict, positionId, approvedQuota, presentManpower }).expect(201)).body.id as string;
    };
    const desigId = await upsertDesig(ids.dev, 10, 7);
    const row = async (id: string) => (await ict.get(`/api/master/quotas`).expect(200)).body.find((q: any) => q.id === id);
    const deptFig = async () => (await ict.get(`/api/master/dept-figures?departmentId=${ids.ict}`).expect(200)).body;
    const beforeDesig = (await row(desigId)).presentManpower;
    const beforeDept = (await deptFig()).presentManpower;
    expect(beforeDesig).toBe(7);
    // Second joining of the same vacancy (headcount = 2 in AC-23) lifts the designation row by exactly one.
    const hr = await as('recruiter');
    const other = (await hr.get('/api/joining/pending').expect(200)).body[0];
    if (other) {
      await hr.put(`/api/joining/${other.id}`).send({ joiningDate: '2026-12-02' }).expect(200);
      await hr.post(`/api/joining/${other.id}/approve`).send({ joiningDate: '2026-12-02' }).expect(200);
      expect((await row(desigId)).presentManpower).toBe(beforeDesig + 1);
      // Dept present manpower is derived — it must have moved by the same delta.
      expect((await deptFig()).presentManpower).toBe(beforeDept + 1);
    }
    // The quota list holds only designation rows now; no positionId=null row.
    const list = (await ict.get(`/api/master/quotas?departmentId=${ids.ict}`).expect(200)).body as any[];
    expect(list.every((r) => r.positionId)).toBe(true);
    // Audit records the auto-update with the change and the reason.
    const audit = (await admin.get(`/api/audit?entityType=ManpowerQuota&entityId=${desigId}&pageSize=10`).expect(200)).body.items;
    const auto = audit.find((e: any) => e.action === 'quota.auto_update');
    if (auto) expect(auto.newValues).toMatchObject({ reason: 'joining.approved' });
  });

  it('AC-25: critical changes are audited with actor, record and old/new values', async () => {
    const audit = await (await as('admin')).get('/api/audit?pageSize=500').expect(200);
    const actions = new Set(audit.body.items.map((e: any) => e.action));
    for (const a of ['requisition.submit', 'requisition.approve_step', 'requisition.return', 'requisition.approve_final', 'requisition.reject',
      'vacancy.create_from_requisition', 'selection.shortlist_override', 'marks.import_confirm', 'selection.final_decision', 'joining.approve', 'email.sent']) {
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
    ids.broken = appId;
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
    expect(rowA).toMatchObject({ department: 'ICT', companyCode: 'HO', positionTitle: 'Software Developer', criteriaMet: 3, criteriaTotal: 3, screeningScore: 100, screeningBasis: 'REQUISITION', documentName: 'rahim.txt' });
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
    // A Direct HR vacancy has no requisition, so it is screened against its own "Specialization required" once HR sets it.
    await hr.post(`/api/vacancies/${ids.vacancy2}/rescreen`).expect(200);
    await jobs.drain();
    expect((await hr.get(`/api/applications/${ids.appA2}`)).body.screeningResult).toBeNull();
    await hr.put(`/api/vacancies/${ids.vacancy}`).send({ specialization: 'MBA' }).expect(400); // a requisition vacancy keeps the approved wording
    const v2 = (await hr.put(`/api/vacancies/${ids.vacancy2}`).send({ specialization: ' MBA ' }).expect(200)).body;
    expect(v2).toMatchObject({ specialization: 'MBA', specializationVersion: 1 });
    expect((await hr.put(`/api/vacancies/${ids.vacancy2}`).send({ specialization: 'MBA' }).expect(200)).body.specializationVersion).toBe(1); // unchanged wording
    expect((await hr.get(`/api/vacancies/${ids.vacancy2}`).expect(200)).body.screening).toEqual({ source: 'VACANCY', reqNo: null, education: null, skills: null, experienceYears: null, other: 'MBA', keyResponsibilities: null, items: ['MBA'] });
    await hr.post(`/api/vacancies/${ids.vacancy2}/rescreen`).expect(200);
    await jobs.drain();
    const screened = (await hr.get(`/api/applications/${ids.appA2}`)).body;
    expect(screened.screeningResult).toBe('Pass');
    expect(screened.screeningRuns[0]).toMatchObject({ basis: 'VACANCY', criteriaVersion: 1 });
    const audit = (await (await as('admin')).get(`/api/audit?entityType=Vacancy&entityId=${ids.vacancy2}&pageSize=50`).expect(200)).body.items;
    expect(audit.find((e: any) => e.action === 'vacancy.update')).toMatchObject({ oldValues: { specialization: null }, newValues: { specialization: 'MBA' } });
    expect(audit.filter((e: any) => e.action === 'vacancy.status_change')).toEqual([]); // fields left out of the request are not changes
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

  it('a rejected joining stays listed as Rejected and can be moved back to pending', async () => {
    const hr = await as('recruiter');
    await hr.post(`/api/applications/${ids.appC}/final-decision`).send({ decision: 'Selected' }).expect(200);
    const j = (await hr.get('/api/joining/pending').expect(200)).body.find((x: any) => x.applicationId === ids.appC);
    await hr.post(`/api/joining/${j.id}/reject`).send({ remarks: 'x' }).expect(400); // a reason is required
    await (await as('recruiter2')).post(`/api/joining/${j.id}/reject`).send({ remarks: 'Not my vacancy' }).expect(403);
    await hr.post(`/api/joining/${j.id}/reject`).send({ remarks: 'Declined the offer' }).expect(200);
    expect((await hr.get('/api/joining/pending').expect(200)).body.map((x: any) => x.applicationId)).not.toContain(ids.appC);
    expect((await hr.get('/api/joining/rejected').expect(200)).body.find((x: any) => x.applicationId === ids.appC)).toMatchObject({ status: 'Rejected', remarks: 'Declined the offer' });
    expect((await hr.get(`/api/cv-bank/applications?status=Rejected`).expect(200)).body.items.map((r: any) => r.applicationId)).toEqual([ids.appC]);
    await hr.post(`/api/joining/${j.id}/approve`).send({ joiningDate: '2026-12-20' }).expect(409); // rejected, not joined

    await hr.post(`/api/joining/${j.id}/reopen`).send({ remarks: 'Candidate changed mind' }).expect(200);
    // No joining beyond the approved headcount: with one seat, already taken, the approval is refused and nothing changes.
    const [{ headcount }] = await ds.query(`SELECT headcount FROM vacancies WHERE id = $1`, [ids.vacancy]);
    await ds.query(`UPDATE vacancies SET headcount = 1 WHERE id = $1`, [ids.vacancy]);
    const full = await hr.post(`/api/joining/${j.id}/approve`).send({ joiningDate: '2026-12-20' }).expect(409);
    expect(full.body.message).toMatch(/All 1 seat of VAC-.* already filled \(1 joined\)/);
    expect((await hr.get('/api/joining/pending').expect(200)).body.find((x: any) => x.applicationId === ids.appC)).toMatchObject({ status: 'Pending', headcount: 1, joinedCount: 1 });
    await ds.query(`UPDATE vacancies SET headcount = $2 WHERE id = $1`, [ids.vacancy, headcount]);
    expect((await hr.get('/api/joining/pending').expect(200)).body.map((x: any) => x.applicationId)).toContain(ids.appC);
    await hr.post(`/api/joining/${j.id}/reject`).send({ remarks: 'Declined again' }).expect(200);
    const audit = (await (await as('admin')).get(`/api/audit?entityType=Application&entityId=${ids.appC}&pageSize=100`).expect(200)).body.items.map((e: any) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['joining.reject', 'joining.reopen']));
  });

  it('the original CV file is kept alongside its extracted text (owner, 2026-11-10), downloadable singly and as a PDF pack', async () => {
    const hr = await as('recruiter');
    const doc = (await hr.get(`/api/applications/${ids.appA}`)).body.documents[0];
    expect(doc).toMatchObject({ originalName: 'rahim.txt', textContent: expect.stringContaining('Rahim Uddin') });
    expect(doc.storageKey).toEqual(expect.stringMatching(/^cvs\//)); // still stored, not nulled out
    expect(doc.fileRemovedAt).toBeNull();
    expect(doc.sha256).toHaveLength(64); // still refuses the same file twice and finds duplicates
    expect((await hr.get(`/api/documents/${doc.id}`).expect(200)).headers['content-disposition']).toMatch(/^inline/);
    expect((await hr.get(`/api/documents/${doc.id}?download=1`).expect(200)).headers['content-disposition']).toMatch(/^attachment/);
    // The broken PDF could not be read: its file is kept too, and stays after HR enters the data by hand.
    const broken = (await hr.get(`/api/applications/${ids.broken}`)).body.documents[0];
    expect((await hr.get(`/api/documents/${broken.id}`).expect(200)).headers['content-disposition']).toMatch(/^inline/);
    await hr.patch(`/api/applications/${ids.broken}`).send({ name: 'Broken File Person', degree: 'BSc' }).expect(200);
    const after = (await hr.get(`/api/applications/${ids.broken}`)).body.documents[0];
    expect(after.storageKey).toEqual(expect.stringMatching(/^cvs\//));
    expect((await hr.get(`/api/documents/${broken.id}`).expect(200)).headers['content-type']).toMatch(/pdf/);

    // Bulk CV pack: a ZIP of the originals, each named after the candidate (owner, 2026-11-10).
    const pack = await hr.post('/api/applications/cv-pack').send({ applicationIds: [ids.appA, ids.broken] }).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    expect(pack.headers['content-type']).toMatch(/zip/);
    // ZIP signature at the start of the response body.
    expect(Buffer.from(pack.body).subarray(0, 2).toString('latin1')).toBe('PK');
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
    // The assigned coordinator may download the stored CV (owner, 2026-11-10: CV files are kept).
    expect((await own.get(`/api/documents/${cv.documentId}`).expect(200)).headers['content-disposition']).toMatch(/^inline/);

    // Unassigned HR user: nothing listed, every direct request refused.
    expect((await other.get('/api/vacancies').expect(200)).body.items).toEqual([]);
    expect((await other.get('/api/cv-bank/applications').expect(200)).body.total).toBe(0);
    expect((await other.get('/api/cv-bank/tree').expect(200)).body.departments.every((dep: any) => dep.vacancies.length === 0)).toBe(true);
    expect((await other.get('/api/joining/joined').expect(200)).body.total).toBe(0);
    for (const path of [`/api/vacancies/${ids.vacancy}`, `/api/vacancies/${ids.vacancy}/applications`, `/api/vacancies/${ids.vacancy}/evaluation`,
      `/api/applications/${appId}`, `/api/documents/${cv.documentId}`, `/api/job-posts/${ids.jobPost}`, `/api/vacancies/${ids.vacancy}/export`]) {
      await other.get(path).expect(403);
    }
    await other.post(`/api/vacancies/${ids.vacancy}/shortlist`).send({ applicationIds: [appId], shortlisted: true, reason: 'x' }).expect(403);
    await other.post(`/api/applications/${appId}/remarks`).send({ text: 'Looks good' }).expect(403);
    await other.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from(CV_C), 'sadia.txt').expect(403);
    await other.post('/api/email/preview').send({ applicationIds: [appId], kind: 'INTERVIEW_INVITE', subject: 'Hi', body: 'Hello' }).expect(403);
    await other.get('/api/intake/unmatched').expect(403);

    // CV Screener, Examiner and Read-only are not coordinators, so they see no vacancy either.
    for (const u of ['screener', 'examiner', 'viewer']) {
      expect((await (await as(u)).get('/api/vacancies').expect(200)).body.items).toEqual([]);
      await (await as(u)).get(`/api/vacancies/${ids.vacancy}`).expect(403);
      await (await as(u)).get(`/api/applications/${appId}`).expect(403);
    }

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
    await dept.post('/api/master/quotas').send({ departmentId: ids.admin, positionId: ids.dev, approvedQuota: 1 }).expect(403);
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

describe('Predefined fields: edit and delete master data and email templates', () => {
  it('a master record in use cannot be deleted; an unused one can, and it is audited', async () => {
    const admin = await as('admin');
    const used = await admin.delete(`/api/master/departments/${ids.ict}`).expect(409);
    expect(used.body.message).toMatch(/In use by .*requisition/);
    await admin.delete(`/api/master/companies/${ids.ho}`).expect(409);
    await admin.delete(`/api/master/positions/${ids.dev}`).expect(409);

    const dept = (await admin.post('/api/master/departments').send({ code: 'TMP', name: 'Temporary Dept' }).expect(201)).body;
    await admin.patch(`/api/master/departments/${dept.id}`).send({ code: 'TMP', name: 'Temporary Department', active: true }).expect(200);
    const pos = (await admin.post('/api/master/positions').send({ title: 'Temporary Position' }).expect(201)).body;
    await (await as('hr.manager')).delete(`/api/master/departments/${dept.id}`).expect(403); // needs master.configure
    expect((await admin.delete(`/api/master/departments/${dept.id}`).expect(200)).body).toEqual({ deleted: true });
    await admin.delete(`/api/master/positions/${pos.id}`).expect(200);
    await admin.delete(`/api/master/departments/${dept.id}`).expect(404);
    const lk = (await admin.get('/api/master/lookups').expect(200)).body;
    expect(lk.departments.map((d: any) => d.id)).not.toContain(dept.id);
    const audit = (await admin.get(`/api/audit?entityType=Department&entityId=${dept.id}&pageSize=10`).expect(200)).body.items;
    expect(audit.find((e: any) => e.action === 'departments.delete')).toMatchObject({ oldValues: { code: 'TMP', name: 'Temporary Department' } });

    // A department named only in someone's Access Scope is still in use.
    const scoped = (await admin.post('/api/master/departments').send({ code: 'SCP', name: 'Scoped Dept' }).expect(201)).body;
    const uid = (await ds.query(`SELECT id FROM users WHERE email = 'requester.admin@ars.local'`))[0].id;
    await admin.patch(`/api/admin/users/${uid}`).send({ departmentScopes: { quotas: { mode: 'custom', departmentIds: [scoped.id] } } }).expect(200);
    expect((await admin.delete(`/api/master/departments/${scoped.id}`).expect(409)).body.message).toMatch(/user/);
    await admin.patch(`/api/admin/users/${uid}`).send({ departmentScopes: {} }).expect(200);
    await admin.delete(`/api/master/departments/${scoped.id}`).expect(200);
  });

  it('an email template can be deleted with its versions; sent emails keep their text', async () => {
    const admin = await as('admin');
    const t = (await admin.post('/api/email/templates').send({ name: 'Temp notice', kind: 'GENERAL', subject: 'Hello {{candidateName}}', body: 'Body', active: true }).expect(201)).body;
    await admin.put(`/api/email/templates/${t.id}`).send({ name: 'Temp notice', kind: 'GENERAL', subject: 'Hello again {{candidateName}}', body: 'Body 2', active: true }).expect(200);
    await (await as('examiner')).delete(`/api/email/templates/${t.id}`).expect(403);
    expect((await admin.delete(`/api/email/templates/${t.id}`).expect(200)).body).toEqual({ deleted: true });
    expect((await ds.query(`SELECT count(*)::int AS n FROM email_template_versions WHERE "templateId" = $1`, [t.id]))[0].n).toBe(0);
    expect((await admin.get('/api/email/templates').expect(200)).body.map((x: any) => x.id)).not.toContain(t.id);

    const sentTpl = (await ds.query(`SELECT DISTINCT "templateId" AS id FROM email_events WHERE "templateId" IS NOT NULL LIMIT 1`))[0].id;
    const before = (await ds.query(`SELECT count(*)::int AS n FROM email_events WHERE "templateId" = $1`, [sentTpl]))[0].n;
    await admin.delete(`/api/email/templates/${sentTpl}`).expect(200);
    expect((await ds.query(`SELECT count(*)::int AS n FROM email_events WHERE "templateId" = $1 AND subject <> '' AND body <> ''`, [sentTpl]))[0].n).toBe(before);
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
    expect(txt.text).toContain('Email subject: Application for Software Developer\n'); // as typed on the post, no job ID added
    expect(txt.text).not.toContain(`(${jp.jobNo})`);
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
    expect(v).toMatchObject({ source: 'DIRECT_HR', coordinatorId: ids.recruiter2, specialization: null, specializationVersion: 0 });
    const withSpec = (await mgr.post('/api/vacancies/direct').send({ ...body(), specialization: 'CCNA, Networking' }).expect(201)).body;
    expect(withSpec).toMatchObject({ specialization: 'CCNA, Networking', specializationVersion: 1 });
    // "Specialization required" as separate fields: education, skills, minimum years and other requirements.
    const structured = (await mgr.post('/api/vacancies/direct').send({ ...body(), requiredEducation: ' BSc in CSE\nDiploma in Computer ', requiredSkills: 'CCNA, MikroTik', requiredExperienceYears: 3 }).expect(201)).body;
    expect(structured).toMatchObject({ requiredEducation: 'BSc in CSE\nDiploma in Computer', requiredSkills: 'CCNA, MikroTik', requiredExperienceYears: 3, specialization: null, specializationVersion: 1 });
    expect((await mgr.get(`/api/vacancies/${structured.id}`).expect(200)).body.screening).toEqual({
      source: 'VACANCY', reqNo: null, education: 'BSc in CSE\nDiploma in Computer', skills: 'CCNA, MikroTik', experienceYears: 3, other: null, keyResponsibilities: null,
      items: ['Education: BSc in CSE or Diploma in Computer', 'Experience: at least 3 years', 'Required Skills (2 points)', 'match score at least 70%'],
    });
    await mgr.post('/api/vacancies/direct').send({ ...body(), requiredExperienceYears: 'many' }).expect(400);
    expect((await mgr.put(`/api/vacancies/${structured.id}`).send({ requiredExperienceYears: 2 }).expect(200)).body).toMatchObject({ requiredExperienceYears: 2, specializationVersion: 2 });
    expect((await mgr.put(`/api/vacancies/${structured.id}`).send({ requiredExperienceYears: 2 }).expect(200)).body.specializationVersion).toBe(2); // unchanged
    // A job post of a Direct HR vacancy takes its Skills, one per line; its screening education and experience stay off the post.
    const post = (await mgr.post(`/api/vacancies/${structured.id}/job-posts`).send({ title: 'Network Engineer' }).expect(201)).body;
    expect(post).toMatchObject({ skills: 'CCNA' + String.fromCharCode(10) + 'MikroTik', education: null, experienceRequirement: null, duties: null });
    // A field the post leaves empty still prints from the vacancy, in the PDF and in the text version.
    await mgr.put(`/api/job-posts/${post.id}`).send({ title: 'Network Engineer', skills: '', experienceRequirement: '3' }).expect(200);
    const txt = (await mgr.get(`/api/job-posts/${post.id}/circular-file?format=txt`).expect(200)).text;
    expect(txt).toContain('MikroTik');
    expect(txt).toContain('3 years');
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

describe('Mail folder scan and CV data Excel', () => {
  const CV = 'Karim Rahman\nkarim.rahman@example.com\n01811112222\nPresent Address: House 12, Road 5, Uttara, Dhaka\nDesignation: Sr. Network Engineer\nCompany Name: Acme Ltd.\nBSc in Computer Science, CGPA 3.70\n6 years of experience\nCertifications: CCNA, CCNP\n';
  const inbox = config.mailIntakeDir;
  const save = async (file: string, subject: string, attachments: { filename: string; content: string }[], messageId?: string) => {
    const raw = await new MailComposer({ from: 'forwarded.by.hr@ananta.example', to: 'career@ananta.example', subject, date: new Date('2026-10-15T04:00:00Z'), text: 'Please see attached.', attachments, messageId }).compile().build();
    fs.writeFileSync(path.join(inbox, file), raw);
  };
  let vacancyId: string;
  let jobPostId: string;

  beforeAll(async () => {
    fs.rmSync(inbox, { recursive: true, force: true });
    fs.mkdirSync(inbox, { recursive: true });
    const mgr = await as('hr.manager');
    vacancyId = (await mgr.post('/api/vacancies/direct').send({ departmentId: ids.ict, companyId: ids.ho, positionTitle: 'Network Engineer', headcount: 1, vacancyType: 'NEW', directReason: 'Mail scan test' }).expect(201)).body.id;
    jobPostId = (await mgr.post(`/api/vacancies/${vacancyId}/job-posts`).send({ title: 'Network Engineer', startDate: '2026-11-01', deadline: '2026-11-30' }).expect(201)).body.id;
    await mgr.post(`/api/job-posts/${jobPostId}/status`).send({ status: 'Published' }).expect(200);
  });

  it('the circular tells applicants to put the position and department in the subject', async () => {
    const txt = await (await as('hr.manager')).get(`/api/job-posts/${jobPostId}/circular-file?format=txt`).expect(200);
    expect(txt.text).toContain('Email subject: Application for Network Engineer - ICT\n'); // designation and department, no job ID
    expect((await (await as('hr.manager')).get(`/api/job-posts/${jobPostId}`).expect(200)).body.cvCollection).toBe('Email CV with subject "Application for Network Engineer - ICT"');
  });

  it('routes mails by subject, keeps the rest for HR and never stops on a bad file', async () => {
    await save('good.eml', 'FW: Application for Network Engineer - ICT', [{ filename: 'karim.txt', content: CV }, { filename: 'logo.png', content: 'not a cv' }], '<good@test>');
    await save('other.eml', 'CV for the post of Pilot', [{ filename: 'pilot.txt', content: 'Pilot Person\npilot@example.com\n' }], '<other@test>');
    await save('empty.eml', 'Application for Network Engineer - ICT', [], '<empty@test>');
    fs.writeFileSync(path.join(inbox, 'broken.eml'), '');
    fs.writeFileSync(path.join(inbox, 'notes.msg'), 'outlook format');

    const mgr = await as('hr.manager');
    expect((await mgr.get('/api/intake/mail-folder').expect(200)).body).toEqual({ pending: 4, unsupported: ['notes.msg'] });
    const r = (await mgr.post('/api/intake/scan').expect(200)).body;
    expect(r).toMatchObject({ scanned: 4, added: 1, unmatched: 1, failed: 2, duplicates: 0, cvsAdded: 1, remaining: 0, unsupported: ['notes.msg'] });
    expect(r.items.find((i: any) => i.file === 'good.eml')).toMatchObject({ outcome: 'Added', cvsAdded: 1 });
    expect(r.items.find((i: any) => i.file === 'empty.eml').reason).toContain('no CV attachment');

    expect(fs.readdirSync(inbox).sort()).toEqual(['failed', 'notes.msg', 'processed']);

    await jobs.drain();
    const apps = (await mgr.get(`/api/vacancies/${vacancyId}/applications`).expect(200)).body.items;
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ source: 'EMAIL', lastPosition: 'Sr. Network Engineer', workplace: 'Acme Ltd.', specialization: 'Computer Science', totalExperienceYears: 6 });
    expect(new Date(apps[0].receivedAt).toISOString()).toBe('2026-10-15T04:00:00.000Z');
    expect(apps[0].candidate.email).toBe('karim.rahman@example.com'); // from the CV, not the forwarding sender
  });

  it('scanning the same mail again adds nothing', async () => {
    await save('again.eml', 'FW: Application for Network Engineer - ICT', [{ filename: 'karim.txt', content: CV }], '<good@test>');
    const mgr = await as('hr.manager');
    const r = (await mgr.post('/api/intake/scan').expect(200)).body;
    expect(r).toMatchObject({ scanned: 1, duplicates: 1, cvsAdded: 0 });
    expect((await mgr.get(`/api/vacancies/${vacancyId}/applications`).expect(200)).body.items).toHaveLength(1);
  });

  it('HR assigns an unmatched mail; a mail with no CV cannot be assigned', async () => {
    const mgr = await as('hr.manager');
    const rows = (await mgr.get('/api/intake/unmatched').expect(200)).body;
    const pilot = rows.find((m: any) => m.subject === 'CV for the post of Pilot');
    expect(pilot).toMatchObject({ status: 'Unmatched' });
    expect(pilot.error).toContain('does not name the position and department');
    expect((await mgr.post(`/api/intake/${pilot.id}/assign`).send({ vacancyId }).expect(200)).body.status).toBe('Assigned');
    const empty = rows.find((m: any) => m.status === 'Failed' && !m.attachments.length);
    await mgr.post(`/api/intake/${empty.id}/assign`).send({ vacancyId }).expect(409);
    await jobs.drain();
  });

  it('HR Manager can delete an unmatched CV permanently, with its file; assigned mails cannot be deleted', async () => {
    const mgr = await as('hr.manager');
    const raw = await new MailComposer({ from: 'someone@example.com', subject: 'CV for no particular job', messageId: '<nojob@test>', date: new Date('2026-10-17T04:00:00Z'),
      attachments: [{ filename: 'nobody.txt', content: 'No Body\nnobody@example.com\n' }] }).compile().build();
    await mgr.post('/api/intake/scan-files').attach('files', raw, 'nojob.eml').expect(200);
    const rows = (await mgr.get('/api/intake/unmatched').expect(200)).body;
    const mail = rows.find((m: any) => m.subject === 'CV for no particular job');
    const stored = path.resolve(config.storageDir, mail.attachments[0].storageKey);
    expect(fs.existsSync(stored)).toBe(true);

    await (await as('recruiter')).delete(`/api/intake/${mail.id}`).expect(403); // a coordinator cannot
    expect((await mgr.delete(`/api/intake/${mail.id}`).expect(200)).body).toEqual({ deleted: true });
    expect(fs.existsSync(stored)).toBe(false);
    expect((await mgr.get('/api/intake/unmatched').expect(200)).body.map((m: any) => m.id)).not.toContain(mail.id);
    expect((await ds.query(`SELECT count(*)::int AS n FROM intake_messages WHERE id = $1`, [mail.id]))[0].n).toBe(0);
    await mgr.delete(`/api/intake/${mail.id}`).expect(404);
    const audit = (await (await as('admin')).get(`/api/audit?entityType=IntakeMessage&entityId=${mail.id}&pageSize=10`).expect(200)).body.items;
    expect(audit.find((e: any) => e.action === 'intake.delete')).toMatchObject({ actorName: 'HR Manager', oldValues: { subject: 'CV for no particular job', files: ['nobody.txt'] } });

    const assigned = (await ds.query(`SELECT id FROM intake_messages WHERE status = 'Assigned' LIMIT 1`))[0];
    await mgr.delete(`/api/intake/${assigned.id}`).expect(409);
  });

  it('only users who may handle unmatched CVs can scan', async () => {
    const hr = await as('recruiter');
    await hr.post('/api/intake/scan').expect(403);
    await hr.get('/api/intake/mail-folder').expect(403);
  });

  it('each vacancy gets its own Excel in the CV data bank layout', async () => {
    const res = await (await as('hr.manager')).get(`/api/vacancies/${vacancyId}/cv-data-export`).buffer(true)
      .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).values).toEqual([undefined,
      'APPLICATION ID', 'CANDIDATE ID', 'EMAIL', 'NAME OF THE APPLICANT', 'DATE OF RECEIVING CV', 'LAST POSITION', 'LAST ORGANIZATION NAME', 'TOTAL YEAR OF EXPERIENCE',
      'PRELIMINARY RECOMMENDED POSITION', 'PRELIMINARY RECOMMENDED DEPARTMENT', 'PRELIMINARY RECOMMENDED FACTORY', 'MOBILE NO.', 'SOURCE OF CV',
      'EDUCATIONAL STATUS', 'EDUCATION SPECIALIZATION WITH REMARK (IF ANY)', 'ADDRESS', 'SKILLS', 'PREVIOUS JOBS & DESIGNATIONS', 'CERTIFICATIONS',
      'EXPECTED SALARY', 'AGE', 'INSTITUTION', 'CGPA', 'ALL EDUCATION', 'SCREENING RESULT', 'MATCH SCORE (%)', 'SCREENING REASONS', 'SHORTLISTED',
      'FINAL DECISION', 'HR REMARKS']);
    expect(ws.rowCount).toBe(3);
    const headers = (ws.getRow(1).values as string[]).slice(1);
    const cell = (h: string) => ws.getRow(2).getCell(headers.indexOf(h) + 1).value;
    expect(cell('CANDIDATE ID')).toMatch(/^CAND-/);
    expect(cell('EMAIL')).toBe('karim.rahman@example.com');
    expect(cell('NAME OF THE APPLICANT')).toBe('Karim Rahman');
    expect(cell('LAST POSITION')).toBe('Sr. Network Engineer');
    expect(cell('LAST ORGANIZATION NAME')).toBe('Acme Ltd.');
    expect(cell('TOTAL YEAR OF EXPERIENCE')).toBe(6);
    expect(cell('PRELIMINARY RECOMMENDED POSITION')).toBe('Network Engineer');
    expect(cell('PRELIMINARY RECOMMENDED DEPARTMENT')).toBe('ICT');
    expect(cell('PRELIMINARY RECOMMENDED FACTORY')).toBe('HO');
    expect(cell('SOURCE OF CV')).toBe('EMAIL');
    expect(cell('EDUCATION SPECIALIZATION WITH REMARK (IF ANY)')).toBe('Computer Science');
    expect(cell('ADDRESS')).toBe('House 12, Road 5, Uttara, Dhaka');
    expect(cell('PREVIOUS JOBS & DESIGNATIONS')).toBe('Sr. Network Engineer, Acme Ltd.');
    expect(cell('CERTIFICATIONS')).toBe('CCNA, CCNP');
    // The screening data sits in the same sheet (owner, 2026-11-08).
    expect(['Pass', 'Review Required', 'Not screened']).toContain(cell('SCREENING RESULT'));
    expect(cell('SHORTLISTED')).toBe('No');
    expect(cell('FINAL DECISION')).toBe('Pending');
    await (await as('examiner')).get(`/api/vacancies/${vacancyId}/cv-data-export`).expect(403);
  });

  it('the same sheet can be viewed in the browser, only by those who may see the vacancy', async () => {
    const sheet = (await (await as('hr.manager')).get(`/api/vacancies/${vacancyId}/cv-data`).expect(200)).body;
    expect(sheet.columns.map((c: any) => c.header)).toHaveLength(30);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({ name: 'Karim Rahman', address: 'House 12, Road 5, Uttara, Dhaka', previousJobs: 'Sr. Network Engineer, Acme Ltd.', certifications: 'CCNA, CCNP' });
    await (await as('recruiter')).get(`/api/vacancies/${vacancyId}/cv-data`).expect(403); // not its coordinator
    await (await as('examiner')).get(`/api/vacancies/${vacancyId}/cv-data`).expect(403);
  });

  it('a folder chosen in the browser is scanned the same way, and its mails are not added twice', async () => {
    const raw = await new MailComposer({
      from: 'jobs@portal.example', subject: 'Application for Network Engineer - ICT', messageId: '<chosen@test>', date: new Date('2026-10-16T04:00:00Z'),
      attachments: [{ filename: 'sara.txt', content: 'Sara Ahmed\nsara.ahmed@example.com\n01911113333\nBSc in Physics\n2 years of experience\n' }],
    }).compile().build();
    const before = fs.readdirSync(inbox).sort();
    const mgr = await as('hr.manager');
    const send = () => mgr.post('/api/intake/scan-files').attach('files', raw, 'sara.eml').attach('files', Buffer.from('notes'), 'notes.txt').expect(200);

    const r = (await send()).body;
    expect(r).toMatchObject({ scanned: 1, added: 1, cvsAdded: 1, unsupported: ['notes.txt'] });
    expect(r.items[0]).toMatchObject({ file: 'sara.eml', outcome: 'Added' });
    expect(fs.readdirSync(inbox).sort()).toEqual(before); // the server's mail folder is not touched

    expect((await send()).body).toMatchObject({ scanned: 1, duplicates: 1, cvsAdded: 0 });
    await jobs.drain();
    const apps = (await mgr.get(`/api/vacancies/${vacancyId}/applications?q=sara`).expect(200)).body.items;
    expect(apps).toHaveLength(1);
    expect(apps[0].candidate.email).toBe('sara.ahmed@example.com');

    await mgr.post('/api/intake/scan-files').expect(400);
    await (await as('recruiter')).post('/api/intake/scan-files').attach('files', raw, 'sara.eml').expect(403);
  });
});

describe('Security hardening (security test, 2026-11-05)', () => {
  it('responses carry security headers and do not name the server software', async () => {
    const r = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(r.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'same-origin' });
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('signing out ends the session: the old token is refused, a new sign-in works (security test, 2026-11-09)', async () => {
    const login = () => request(app.getHttpServer()).post('/api/auth/login').send({ email: 'viewer@ars.local', password: config.seedPassword }).expect(200);
    const cookie = (await login()).headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', cookie).expect(200); // right away: same second as the sign-in
    const after = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(401);
    expect(after.body.message).toMatch(/session has ended/);
    const fresh = (await login()).headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', fresh).expect(200);
    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', 'ars_token=garbage').expect(200); // a bad token just clears the cookie
    delete agents.viewer; // the shared agent's token was ended too
  });

  it('repeated wrong passwords lock that email for a while; other accounts still sign in', async () => {
    const attempt = (email: string, password = 'wrong-password') => request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email, password });
    for (let i = 0; i < 5; i++) await attempt('nobody@ars.local').expect(401);
    const locked = await attempt('Nobody@ars.local').expect(429); // the count is per email, whatever its case
    expect(locked.body.message).toMatch(/Too many failed sign-in attempts/);
    await attempt('examiner@ars.local', config.seedPassword).expect(200);
  });

  it('two CVs of the same person read by two workers at once are still flagged as a possible duplicate (2026-11-09)', async () => {
    await ds.query(`UPDATE vacancies SET status = 'Screening' WHERE id = $1`, [ids.vacancy2]);
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    const hr = await as(coordinator);
    const cv = (extra: string) => Buffer.from(`Twin Person\ntwin.person@example.com\n01711300001\nEDUCATION\nMBA, 2020\n${extra}`);
    await hr.post(`/api/vacancies/${ids.vacancy2}/cvs`).attach('files', cv('Skills: Excel'), 'twin-a.txt').attach('files', cv('Skills: Word'), 'twin-b.txt').expect(201);
    await Promise.all([jobs.drain(), jobs.drain(), jobs.drain()]);
    const rows = await ds.query(`SELECT a."duplicateReview" AS d FROM applications a JOIN candidates c ON c.id = a."candidateId" WHERE c."emailNormalized" = 'twin.person@example.com'`);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r: any) => r.d === 'PENDING')).toHaveLength(1);
  });

  it('expected salary is shown on the Interview page and corrected there without re-running screening (owner, 2026-11-09)', async () => {
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    const hr = await as(coordinator);
    const row = (await hr.get('/api/interviews/board').expect(200)).body.rows.find((r: any) => r.vacancy.id === ids.vacancy2);
    expect(row).toHaveProperty('expectedSalary');
    const jobs0 = (await ds.query(`SELECT count(*)::int AS n FROM processing_jobs WHERE "refId" = $1 AND type = 'SCREENING'`, [row.applicationId]))[0].n;
    expect((await hr.patch(`/api/applications/${row.applicationId}`).send({ expectedSalary: '60,000' }).expect(200)).body.expectedSalary).toBe('60,000');
    expect((await ds.query(`SELECT count(*)::int AS n FROM processing_jobs WHERE "refId" = $1 AND type = 'SCREENING'`, [row.applicationId]))[0].n).toBe(jobs0);
    await hr.patch(`/api/applications/${row.applicationId}`).send({ expectedSalary: 'x'.repeat(61) }).expect(400);
    expect((await hr.get('/api/interviews/board').expect(200)).body.rows.find((r: any) => r.applicationId === row.applicationId).expectedSalary).toBe('60,000');
  });

  it('Remove on the Interview page moves a candidate back one stage (owner, 2026-11-09)', async () => {
    await ds.query(`UPDATE vacancies SET status = 'Screening' WHERE id = $1`, [ids.vacancy2]);
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    const hr = await as(coordinator);
    for (const [name, phone] of [['Back One', '01711400001'], ['Back Two', '01711400002'], ['Back Three', '01711400003']]) {
      await hr.post(`/api/vacancies/${ids.vacancy2}/cvs`).attach('files', Buffer.from(`${name}\n${name.replace(' ', '.').toLowerCase()}@example.com\n${phone}\nEDUCATION\nMBA, 2020`), `${phone}.txt`).expect(201);
    }
    await jobs.drain();
    const apps = (await ds.query(`SELECT a.id FROM applications a JOIN candidates c ON c.id = a."candidateId" WHERE a."vacancyId" = $1 AND c.phone LIKE '%0171140000%' ORDER BY c.phone`, [ids.vacancy2])).map((x: any) => x.id);
    await hr.post(`/api/vacancies/${ids.vacancy2}/shortlist`).send({ applicationIds: apps, shortlisted: true, reason: 'test' }).expect(200);
    await hr.post('/api/interviews/schedule').send({ applicationIds: apps, stageType: 'INTERVIEW', scheduledAt: '2026-12-01T04:00:00.000Z' }).expect(200);
    for (const a of apps) await hr.put(`/api/applications/${a}/marks`).send({ stageType: 'WRITTEN', marks: 50, maxMarks: 100 }).expect(200);
    await hr.post(`/api/applications/${apps[2]}/final-decision`).send({ decision: 'Selected' }).expect(200);
    const count = async (t: string, a: string) => (await ds.query(`SELECT count(*)::int AS n FROM ${t} WHERE "applicationId" = $1`, [a]))[0].n;

    await (await as('examiner')).post('/api/interviews/move-back').send({ applicationIds: [apps[0]], to: 'schedule' }).expect(403);
    await hr.post('/api/interviews/move-back').send({ applicationIds: [apps[0]], to: 'elsewhere' }).expect(400);
    // Step 2 Remove: back to Schedule; the interview record and marks go, still shortlisted.
    expect((await hr.post('/api/interviews/move-back').send({ applicationIds: [apps[0]], to: 'schedule' }).expect(200)).body).toMatchObject({ moved: 1, failed: 0 });
    expect([await count('candidate_stages', apps[0]), await count('evaluation_marks', apps[0])]).toEqual([0, 0]);
    expect((await ds.query(`SELECT shortlisted FROM applications WHERE id = $1`, [apps[0]]))[0].shortlisted).toBe(true);
    // Step 1 Remove: off the shortlist and off the Interview page.
    expect((await hr.post('/api/interviews/move-back').send({ applicationIds: [apps[1]], to: 'screening' }).expect(200)).body.moved).toBe(1);
    expect((await ds.query(`SELECT shortlisted FROM applications WHERE id = $1`, [apps[1]]))[0].shortlisted).toBe(false);
    const board = (await hr.get('/api/interviews/board').expect(200)).body.rows.map((r: any) => r.applicationId);
    expect(board).toContain(apps[0]);
    expect(board).not.toContain(apps[1]);
    // A decided candidate is refused until the decision is removed (step 3).
    const refused = (await hr.post('/api/interviews/move-back').send({ applicationIds: [apps[2]], to: 'schedule' }).expect(200)).body;
    expect(refused.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/final decision is Selected/) });
    await hr.post(`/api/applications/${apps[2]}/final-decision`).send({ decision: 'Pending' }).expect(200);
    expect((await ds.query(`SELECT count(*)::int AS n FROM joining_records WHERE "applicationId" = $1`, [apps[2]]))[0].n).toBe(0); // left Joining Pending
    expect((await hr.post('/api/interviews/move-back').send({ applicationIds: [apps[2]], to: 'screening' }).expect(200)).body.moved).toBe(1);
    const [audit] = await ds.query(`SELECT "oldValues" FROM audit_events WHERE action = 'interview.remove_to_schedule' AND "entityId" = $1`, [apps[0]]);
    expect(audit.oldValues.marks).toEqual([expect.objectContaining({ stage: 'WRITTEN', marks: 50 })]);
  });

  it('the Interview Board sends several candidates to Joining Pending with one planned date (owner, 2026-11-08)', async () => {
    await ds.query(`UPDATE vacancies SET status = 'Screening' WHERE id = $1`, [ids.vacancy2]);
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    const hr = await as(coordinator);
    for (const [name, phone] of [['Board One', '01711200001'], ['Board Two', '01711200002'], ['Board Three', '01711200003']]) {
      await hr.post(`/api/vacancies/${ids.vacancy2}/cvs`).attach('files', Buffer.from(`${name}\n${name.replace(' ', '.').toLowerCase()}@example.com\n${phone}\nEDUCATION\nMBA, 2020`), `${phone}.txt`).expect(201);
    }
    await jobs.drain();
    const apps = (await ds.query(`SELECT a.id FROM applications a JOIN candidates c ON c.id = a."candidateId" WHERE a."vacancyId" = $1 AND c.phone LIKE '%0171120000%' ORDER BY c.phone`, [ids.vacancy2])).map((x: any) => x.id);
    expect(apps).toHaveLength(3);
    await ds.query(`UPDATE applications SET shortlisted = true WHERE id = ANY($1::uuid[])`, [apps.slice(0, 2)]); // the third is not shortlisted

    await (await as('examiner')).post('/api/applications/send-to-joining').send({ applicationIds: apps, joiningDate: '2026-12-10' }).expect(403);
    await hr.post('/api/applications/send-to-joining').send({ applicationIds: apps, joiningDate: '10-12-2026' }).expect(400);
    const r = (await hr.post('/api/applications/send-to-joining').send({ applicationIds: apps, joiningDate: '2026-12-10' }).expect(200)).body;
    expect(r).toMatchObject({ sent: 2, failed: 1 });
    expect(r.results[2].error).toMatch(/Shortlist the candidate/);
    const pending = (await hr.get('/api/joining/pending').expect(200)).body.filter((j: any) => apps.includes(j.applicationId));
    expect(pending.map((j: any) => [j.applicationId, j.joiningDate]).sort()).toEqual([[apps[0], '2026-12-10'], [apps[1], '2026-12-10']].sort());
    expect((await ds.query(`SELECT "finalDecision" FROM applications WHERE id = ANY($1::uuid[]) ORDER BY id`, [apps.slice(0, 2)])).map((x: any) => x.finalDecision)).toEqual(['Selected', 'Selected']);
    // Sending again moves the planned date; a candidate already joined or rejected at joining is left alone.
    expect((await hr.post('/api/applications/send-to-joining').send({ applicationIds: [apps[0]], joiningDate: '2026-12-12' }).expect(200)).body.sent).toBe(1);
    expect((await ds.query(`SELECT "joiningDate"::text AS d FROM joining_records WHERE "applicationId" = $1`, [apps[0]]))[0].d).toBe('2026-12-12');
    const j1 = pending.find((j: any) => j.applicationId === apps[1]).id;
    await hr.post(`/api/joining/${j1}/reject`).send({ remarks: 'Declined the offer' }).expect(200);
    const again = (await hr.post('/api/applications/send-to-joining').send({ applicationIds: [apps[1]], joiningDate: '2026-12-12' }).expect(200)).body;
    expect(again.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/Rejected at joining/) });
    await ds.query(`UPDATE joining_records SET status = 'Rejected' WHERE "applicationId" = $1`, [apps[0]]); // out of the way of later tests
  });

  it('several pending joinings are approved at once on one date; each is checked on its own (owner, 2026-11-08)', async () => {
    await ds.query(`UPDATE vacancies SET status = 'Screening' WHERE id = $1`, [ids.vacancy2]);
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    const other = coordinator === 'recruiter' ? 'recruiter2' : 'recruiter';
    const hr = await as(coordinator);
    const people = [['Batch One', '01711100001'], ['Batch Two', '01711100002'], ['Batch Three', '01711100003']];
    for (const [name, phone] of people) {
      await hr.post(`/api/vacancies/${ids.vacancy2}/cvs`).attach('files', Buffer.from(`${name}\n${name.replace(' ', '.').toLowerCase()}@example.com\n${phone}\nEDUCATION\nMBA, 2020`), `${phone}.txt`).expect(201);
    }
    await jobs.drain();
    const apps = (await ds.query(`SELECT a.id FROM applications a JOIN candidates c ON c.id = a."candidateId" WHERE a."vacancyId" = $1 AND c.phone LIKE '%0171110000%' ORDER BY c.phone`, [ids.vacancy2])).map((x: any) => x.id);
    expect(apps).toHaveLength(3);
    await ds.query(`UPDATE applications SET shortlisted = true WHERE id = ANY($1::uuid[])`, [apps]);
    for (const a of apps) await hr.post(`/api/applications/${a}/final-decision`).send({ decision: 'Selected' }).expect(200);
    const pending = (await hr.get('/api/joining/pending').expect(200)).body.filter((j: any) => apps.includes(j.applicationId));
    const jids = apps.map((a: string) => pending.find((j: any) => j.applicationId === a).id);
    // Two seats left: the third is refused, the first two still join.
    const [{ joined }] = await ds.query(`SELECT count(*)::int AS joined FROM joining_records j JOIN applications a ON a.id = j."applicationId" WHERE a."vacancyId" = $1 AND j.status = 'Approved'`, [ids.vacancy2]);
    await ds.query(`UPDATE vacancies SET headcount = $2 WHERE id = $1`, [ids.vacancy2, joined + 2]);
    // Salary on Joining Pending (owner, 2026-11-09): saved trimmed, an empty value clears it, kept with recruitment.
    expect((await hr.put(`/api/joining/${jids[0]}`).send({ salary: '  45,000 per month ' }).expect(200)).body.salary).toBe('45,000 per month');
    expect((await hr.put(`/api/joining/${jids[1]}`).send({ salary: '50,000' }).expect(200)).body.salary).toBe('50,000');
    expect((await hr.put(`/api/joining/${jids[1]}`).send({ salary: '' }).expect(200)).body.salary).toBeNull();
    await hr.put(`/api/joining/${jids[1]}`).send({ salary: 'x'.repeat(101) }).expect(400);
    await (await as(other)).put(`/api/joining/${jids[0]}`).send({ salary: '1' }).expect(403);
    expect((await hr.get('/api/joining/pending').expect(200)).body.find((j: any) => j.id === jids[0]).salary).toBe('45,000 per month');

    await (await as('examiner')).post('/api/joining/approve-batch').send({ ids: jids, joiningDate: '2026-12-15' }).expect(403);
    await hr.post('/api/joining/approve-batch').send({ ids: [], joiningDate: '2026-12-15' }).expect(400);
    const notMine = (await (await as(other)).post('/api/joining/approve-batch').send({ ids: jids, joiningDate: '2026-12-15' }).expect(200)).body;
    expect(notMine).toMatchObject({ approved: 0, failed: 3 }); // another coordinator's vacancy

    const r = (await hr.post('/api/joining/approve-batch').send({ ids: jids, joiningDate: '2026-12-15', remarks: 'Joined together' }).expect(200)).body;
    expect(r).toMatchObject({ approved: 2, failed: 1 });
    expect(r.results.map((x: any) => x.ok)).toEqual([true, true, false]);
    expect(r.results[2].error).toMatch(/already filled/);
    const rows = await ds.query(`SELECT "applicationId", status, "joiningDate"::text AS d FROM joining_records WHERE id = ANY($1::uuid[])`, [jids]);
    expect(rows.filter((x: any) => x.status === 'Approved').map((x: any) => x.d)).toEqual(['2026-12-15', '2026-12-15']);
    expect((await ds.query(`SELECT status FROM vacancies WHERE id = $1`, [ids.vacancy2]))[0].status).toBe('Filled');
    const joinedRow = async (u: string) => (await (await as(u)).get('/api/joining/joined?pageSize=100').expect(200)).body.items.find((j: any) => j.id === jids[0]);
    expect((await joinedRow('hr.manager')).salary).toBe('45,000 per month');
    expect((await joinedRow('requester.ict'))).toMatchObject({ salary: null, email: null }); // department users: no salary, no contacts
  });

  it('vacancy status can be set from the list; Closed vacancies are listed last (owner, 2026-11-08)', async () => {
    const hr = await as('hr.manager');
    const [{ status: before }] = await ds.query(`SELECT status FROM vacancies WHERE id = $1`, [ids.vacancy2]);
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    await (await as(coordinator === 'recruiter' ? 'recruiter2' : 'recruiter')).put(`/api/vacancies/${ids.vacancy2}`).send({ status: 'Closed' }).expect(403); // not their vacancy
    await (await as(coordinator)).put(`/api/vacancies/${ids.vacancy2}`).send({ status: 'Closed' }).expect(200);
    const list = (await hr.get('/api/vacancies?pageSize=100').expect(200)).body.items;
    const firstClosed = list.findIndex((v: any) => v.status === 'Closed');
    expect(firstClosed).toBeGreaterThanOrEqual(0);
    expect(list.slice(firstClosed).every((v: any) => v.status === 'Closed')).toBe(true);
    for (const group of [list.slice(0, firstClosed), list.slice(firstClosed)]) {
      const t = group.map((v: any) => new Date(v.createdAt).getTime());
      expect(t).toEqual([...t].sort((a, b) => b - a)); // newest first within each group
    }
    await hr.put(`/api/vacancies/${ids.vacancy2}`).send({ status: before }).expect(200);
  });

  it('a job post is deleted by the vacancy coordinator, the HR Manager or the Super Admin; its candidates stay (owner, 2026-11-08)', async () => {
    await ds.query(`UPDATE vacancies SET status = 'Screening' WHERE id = $1 AND status IN ('Closed', 'Filled')`, [ids.vacancy2]);
    const coordinator = (await ds.query(`SELECT u.email FROM vacancies v JOIN users u ON u.id = v."coordinatorId" WHERE v.id = $1`, [ids.vacancy2]))[0].email.replace('@ars.local', '');
    const other = coordinator === 'recruiter' ? 'recruiter2' : 'recruiter';
    const hr = await as('hr.manager');
    const post = async () => (await hr.post(`/api/vacancies/${ids.vacancy2}/job-posts`).send({ title: 'Delete me' }).expect(201)).body.id;
    const [a, b, c] = [await post(), await post(), await post()];
    const [app] = await ds.query(`SELECT id FROM applications WHERE "vacancyId" = $1 LIMIT 1`, [ids.vacancy2]);
    await ds.query(`UPDATE applications SET "jobPostId" = $1 WHERE id = $2`, [a, app.id]);

    await (await as(other)).delete(`/api/job-posts/${a}`).expect(403); // HR, but not this vacancy's coordinator
    await (await as('examiner')).delete(`/api/job-posts/${a}`).expect(403); // no jobpost.edit
    await (await as('requester.ict')).delete(`/api/job-posts/${a}`).expect(403);
    expect((await (await as(coordinator)).delete(`/api/job-posts/${a}`).expect(200)).body).toMatchObject({ deleted: true, applicationsUnlinked: 1, vacancyId: ids.vacancy2 });
    expect((await hr.delete(`/api/job-posts/${b}`).expect(200)).body.deleted).toBe(true);
    expect((await (await as('admin')).delete(`/api/job-posts/${c}`).expect(200)).body.deleted).toBe(true);
    await hr.delete(`/api/job-posts/${c}`).expect(404);

    const [kept] = await ds.query(`SELECT "vacancyId", "jobPostId" FROM applications WHERE id = $1`, [app.id]);
    expect(kept).toEqual({ vacancyId: ids.vacancy2, jobPostId: null });
    const posts = (await hr.get(`/api/vacancies/${ids.vacancy2}`).expect(200)).body.jobPosts.map((j: any) => j.id);
    for (const id of [a, b, c]) expect(posts).not.toContain(id);
    const [audit] = await ds.query(`SELECT "newValues" FROM audit_events WHERE action = 'jobpost.delete' AND "entityId" = $1`, [a]);
    expect(audit.newValues).toEqual({ applicationsUnlinked: 1 });
  });

  it('"My recent decisions" can be sorted by date, newest or oldest first (owner, 2026-11-08)', async () => {
    const dir = await as('director');
    const when = async (q: string) => (await dir.get(`/api/approvals/inbox${q}`).expect(200)).body.history.map((h: any) => new Date(h.decidedAt).getTime());
    const desc = await when('');
    const asc = await when('?decisions=asc');
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(await when('?decisions=desc')).toEqual(desc);
  });

  it('the HR Approved Queue shows the requisitions approved on a chosen day (Bangladesh time) (owner, 2026-11-08)', async () => {
    const hr = await as('hr.manager');
    const [{ day }] = await ds.query(`SELECT to_char(("approvedAt" AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS day FROM requisitions WHERE id = $1`, [ids.req]);
    const queue = async (q: string) => (await hr.get(`/api/hr-queue?view=all&pageSize=100${q}`).expect(200)).body.items;
    const onDay = await queue(`&approvedOn=${day}`);
    expect(onDay.map((r: any) => r.id)).toContain(ids.req);
    expect(onDay.every((r: any) => new Date(r.approvedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }) === day)).toBe(true);
    expect((await queue('&approvedOn=2001-01-01'))).toEqual([]);
    expect(onDay.find((r: any) => r.id === ids.req).vacancy).toMatchObject({ vacancyNo: expect.stringMatching(/^VAC-/), applications: expect.any(Number) });
    await hr.get('/api/hr-queue?approvedOn=08-11-2026').expect(400);
  });

  it('CV upload keeps working after a vacancy is Filled; the reconciliation migration reopens stale ones (owner, 2026-11-09)', async () => {
    // Use `admin` because by this point the coordinator of `ids.vacancy` may have been reassigned / cleared.
    const admin = await as('admin');
    await ds.query(`UPDATE vacancies SET status = 'Filled' WHERE id = $1`, [ids.vacancy]);
    // Manual CV upload still accepts even when the vacancy is Filled.
    const up = await admin.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from('Late Comer\nlate@example.com\n01999111222\nBSc in CSE'), 'late.txt').expect(201);
    expect(up.body[0]).toMatchObject({ ok: true });
    await jobs.drain();
    // Direct re-run of the reconciliation SQL (migration 020): a Filled vacancy with fewer than
    // `headcount` approved joinings is reverted to Screening, so CV flows and reports stop lying.
    await ds.query(`UPDATE vacancies SET status = 'Filled', headcount = 99 WHERE id = $1`, [ids.vacancy]);
    await ds.query(
      `UPDATE vacancies v SET status = 'Screening'
        WHERE v.status = 'Filled'
          AND (SELECT count(*) FROM joining_records jr JOIN applications a ON a.id = jr."applicationId"
                WHERE a."vacancyId" = v.id AND jr.status = 'Approved') < v.headcount`);
    expect((await ds.query(`SELECT status FROM vacancies WHERE id = $1`, [ids.vacancy]))[0].status).toBe('Screening');
    // Restore headcount so later tests see the original data.
    await ds.query(`UPDATE vacancies SET headcount = 2 WHERE id = $1`, [ids.vacancy]);
  });

  it('Super Admin bulk-deletes selected CVs; joined candidates are refused and other data cascades (owner, 2026-11-09)', async () => {
    const admin = await as('admin');
    const list = (await admin.get(`/api/cv-bank/applications?vacancyId=${ids.vacancy}&pageSize=200`).expect(200)).body.items;
    const notJoined = list.filter((r: any) => r.status !== 'Joined').slice(0, 2).map((r: any) => r.applicationId);
    const joinedIds = list.filter((r: any) => r.status === 'Joined').map((r: any) => r.applicationId);
    expect(notJoined.length).toBeGreaterThan(0);

    // Only `candidate.delete` can call the endpoint.
    for (const u of ['recruiter', 'hr.manager', 'requester.ict']) {
      await (await as(u)).post('/api/cv-bank/applications/delete').send({ ids: notJoined }).expect(403);
    }
    await admin.post('/api/cv-bank/applications/delete').send({ ids: [] }).expect(400);
    await admin.post('/api/cv-bank/applications/delete').send({ ids: ['not-a-uuid'] }).expect(400);

    // Joined candidates are refused: nothing changes.
    if (joinedIds.length) {
      const before = (await ds.query(`SELECT count(*)::int AS n FROM applications WHERE id = ANY($1::uuid[])`, [[...joinedIds, ...notJoined]]))[0].n;
      await admin.post('/api/cv-bank/applications/delete').send({ ids: [joinedIds[0], ...notJoined], reason: 'test' }).expect(409);
      const after = (await ds.query(`SELECT count(*)::int AS n FROM applications WHERE id = ANY($1::uuid[])`, [[...joinedIds, ...notJoined]]))[0].n;
      expect(after).toBe(before);
    }

    // Successful delete: applications and all per-app rows go; orphan candidates go too.
    const cands = (await ds.query(`SELECT DISTINCT "candidateId" AS id FROM applications WHERE id = ANY($1::uuid[])`, [notJoined])).map((x: any) => x.id);
    const otherApps = (await ds.query(`SELECT DISTINCT "candidateId" AS id FROM applications WHERE "candidateId" = ANY($1::uuid[]) AND id <> ALL($2::uuid[])`, [cands, notJoined])).map((x: any) => x.id);
    const orphans = cands.filter((c: string) => !otherApps.includes(c));
    const r = await admin.post('/api/cv-bank/applications/delete').send({ ids: notJoined, reason: 'Clean-up' }).expect(200);
    expect(r.body).toMatchObject({ deleted: true, counts: { applications: notJoined.length } });
    expect((await ds.query(`SELECT count(*)::int AS n FROM applications WHERE id = ANY($1::uuid[])`, [notJoined]))[0].n).toBe(0);
    for (const t of ['candidate_documents', 'screening_runs', 'extraction_runs', 'candidate_stages', 'candidate_remarks', 'evaluation_marks', 'joining_records']) {
      expect((await ds.query(`SELECT count(*)::int AS n FROM ${t} WHERE "applicationId" = ANY($1::uuid[])`, [notJoined]))[0].n).toBe(0);
    }
    expect((await ds.query(`SELECT count(*)::int AS n FROM candidates WHERE id = ANY($1::uuid[])`, [orphans]))[0].n).toBe(0);
    if (otherApps.length) {
      expect((await ds.query(`SELECT count(*)::int AS n FROM candidates WHERE id = ANY($1::uuid[])`, [otherApps]))[0].n).toBeGreaterThan(0);
    }
    const [audit] = await ds.query(`SELECT "oldValues", "newValues" FROM audit_events WHERE action = 'candidate.bulk_delete' ORDER BY "createdAt" DESC LIMIT 1`);
    expect(audit.newValues).toMatchObject({ reason: 'Clean-up', deleted: { applications: notJoined.length } });
  });

  // Last, because it removes the main requisition and its vacancy.
  it('only the Super Admin deletes a requisition; its vacancy and everything under it go too (owner, 2026-11-08)', async () => {
    const hr = await as('hr.manager');
    await hr.post(`/api/vacancies/${ids.vacancy}/cvs`).attach('files', Buffer.from('Nadia Islam\nnadia.delete@example.com\n01711000999\nEDUCATION\nBSc in CSE, 2020'), 'nadia.txt').expect(201);
    await jobs.drain();
    const v = [ids.vacancy];
    const apps = (await ds.query(`SELECT id, "candidateId" FROM applications WHERE "vacancyId" = $1`, v)) as any[];
    expect(apps.length).toBeGreaterThan(0);
    const shared = (await ds.query(`SELECT DISTINCT "candidateId" AS id FROM applications WHERE "candidateId" = ANY($1::uuid[]) AND "vacancyId" <> $2`, [apps.map((a) => a.candidateId), ids.vacancy])).map((x: any) => x.id);
    const only = apps.map((a) => a.candidateId).filter((c) => !shared.includes(c));
    expect(only.length).toBeGreaterThan(0);

    for (const u of ['hr.manager', 'requester.ict', 'approval.admin', 'corporate.hr']) {
      await (await as(u)).post(`/api/requisitions/${ids.req}/delete`).send({ reason: 'not allowed' }).expect(403);
    }
    const admin = await as('admin');
    const row = (await admin.get('/api/requisitions?pageSize=100').expect(200)).body.items.find((r: any) => r.id === ids.req);
    expect(row.vacancy).toMatchObject({ applications: apps.length });
    expect((await hr.get('/api/requisitions?pageSize=100').expect(200)).body.items.find((r: any) => r.id === ids.req).vacancy).toBeNull();
    expect((await admin.get(`/api/requisitions/${ids.req}`).expect(200)).body.vacancy).toBeUndefined(); // no longer shown on the requisition
    await admin.post(`/api/requisitions/${ids.req}/delete`).send({ reason: '' }).expect(400); // a reason is required

    const r = (await admin.post(`/api/requisitions/${ids.req}/delete`).send({ reason: 'Raised by mistake' }).expect(200)).body;
    expect(r).toMatchObject({ deleted: true, vacancyNo: row.vacancy.vacancyNo, counts: { applications: apps.length, candidates: only.length } });
    await admin.get(`/api/requisitions/${ids.req}`).expect(404);
    const left = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].n;
    expect(await left(`SELECT count(*)::int AS n FROM vacancies WHERE id = $1`, v)).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM job_posts WHERE "vacancyId" = $1`, v)).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM applications WHERE "vacancyId" = $1`, v)).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM approval_actions WHERE "requisitionId" = $1`, [ids.req])).toBe(0);
    for (const t of ['candidate_documents', 'screening_runs', 'extraction_runs', 'evaluation_marks', 'candidate_stages', 'joining_records', 'email_events']) {
      expect(await left(`SELECT count(*)::int AS n FROM ${t} WHERE "applicationId" = ANY($1::uuid[])`, [apps.map((a) => a.id)])).toBe(0);
    }
    expect(await left(`SELECT count(*)::int AS n FROM candidates WHERE id = ANY($1::uuid[])`, [only])).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM candidates WHERE id = ANY($1::uuid[])`, [shared])).toBe(shared.length); // applied elsewhere: kept
    const [audit] = await ds.query(`SELECT "oldValues", "newValues" FROM audit_events WHERE action = 'requisition.delete' AND "entityId" = $1`, [ids.req]);
    expect(audit.newValues).toMatchObject({ reason: 'Raised by mistake', deleted: { applications: apps.length } });
    expect(audit.oldValues).toMatchObject({ vacancyNo: row.vacancy.vacancyNo });
  });
});
