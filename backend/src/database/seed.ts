/**
 * Idempotent prototype seed: roles, master data, named approver accounts, default approval route,
 * sample quotas and email templates. Safe to run repeatedly (upserts by code/email/name).
 *
 *   npm run seed            (uses DATABASE_URL and SEED_PASSWORD from .env)
 *
 * Company names marked "(confirm name)" and the approval order are prototype defaults that the
 * business owner must confirm (SRS section 25).
 */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource, IsNull } from 'typeorm';
import { config } from '../config';
import { DEFAULT_ROLES, P } from '../common/permissions';
import dataSource from './data-source';
import {
  ApprovalRoute, ApprovalRouteStep, Company, PermissionTemplate, Department, EmailTemplate, EmailTemplateVersion, ManpowerQuota, Position, Role, User,
} from './entities';

const COMPANIES: [string, string][] = [
  ['HO', 'Ananta Companies - Head Office'],
  ['AJL', 'Ananta Jeanswear Ltd.'],
  ['PWPL', 'Paradise Washing Plant Limited'],
  ['AGL', 'AGL (confirm name)'],
  ['ASL', 'ASL (confirm name)'],
  ['ABM', 'ABM (confirm name)'],
  ['TT', 'T&T (confirm name)'],
  ['ALCL', 'ALCL (confirm name)'],
  ['CIL', 'CIL (confirm name)'],
];

const DEPARTMENTS: [string, string][] = [
  ['ADMIN', 'Administration'], ['ACC', 'Accounts'], ['COMM', 'Commercial'], ['COMP', 'Compliance'], ['CUT', 'Cutting'],
  ['ENG', 'Engineering'], ['FASH', 'Fashion Designing'], ['FIN', 'Finance'], ['HR', 'Human Resources'], ['ICT', 'ICT'],
  ['IA', 'Internal Audit'], ['LAB', 'Laboratory'], ['MAINT', 'Maintenance'], ['MED', 'Medical'], ['MERCH', 'Merchandising'],
  ['PROD', 'Production (Sewing)'], ['QC', 'Quality Control'], ['SEC', 'Security'], ['STORE', 'Store'], ['SCM', 'Supply Chain'],
  ['TECH', 'Technical'], ['UTIL', 'Utility'], ['WASH', 'Wash Production'], ['WELF', 'Welfare'], ['WS', 'Work Study'],
];

const POSITIONS = [
  'Trainee', 'Assistant', 'Asst. Executive', 'Executive', 'Sr. Executive', 'Asst. Manager', 'Deputy Manager', 'Manager',
  'Sr. Manager', 'AGM', 'DGM', 'GM', 'Director', 'Software Developer', 'Nurse', 'Medical Officer', 'Lab Technician',
];

/** [email, name, designation, departmentCode | null, roleCodes] */
const USERS: [string, string, string, string | null, string[]][] = [
  ['admin@ars.local', 'System Administrator', 'Super Admin', 'ICT', ['SUPER_ADMIN']],
  ['requester.ict@ars.local', 'ICT Department Requester', 'Manager, ICT', 'ICT', ['DEPT_REQUESTER']],
  ['requester.admin@ars.local', 'Admin Department Requester', 'Manager, Administration', 'ADMIN', ['DEPT_REQUESTER']],
  ['director@ars.local', 'Concerned Director', 'Director', null, ['APPROVER']],
  ['concerned.hr@ars.local', 'Concerned HR', 'Manager, HR', 'HR', ['APPROVER']],
  ['aded@ars.local', 'Concerned AD/ED', 'Executive Director', null, ['APPROVER']],
  ['corporate.hr@ars.local', 'Corporate HR', 'Sr. Manager, Corporate HR', 'HR', ['CORPORATE_HR']],
  ['hod.hr@ars.local', 'HOD-HR', 'Head of HR', 'HR', ['APPROVER']],
  ['approval.admin@ars.local', 'Requisition Admin', 'Admin, Requisition Approvals', null, ['ADMIN']],
  ['hr.manager@ars.local', 'HR Manager', 'Manager, Recruitment', 'HR', ['HR_MANAGER']],
  ['recruiter@ars.local', 'HR Recruiter', 'Executive, Recruitment', 'HR', ['HR_COORDINATOR']],
  ['recruiter2@ars.local', 'HR Coordinator Two', 'Asst. Executive, Recruitment', 'HR', ['HR_COORDINATOR']],
  ['screener@ars.local', 'CV Screening User', 'Asst. Executive, HR', 'HR', ['CV_SCREENER']],
  ['examiner@ars.local', 'Interview Examiner', 'Sr. Manager, ICT', 'ICT', ['EXAMINER']],
  ['viewer@ars.local', 'Management Viewer', 'Management', null, ['READ_ONLY']],
];

const ROUTE: [string, string][] = [
  ['Concerned Director', 'director@ars.local'],
  ['Concerned HR', 'concerned.hr@ars.local'],
  ['Concerned AD/ED', 'aded@ars.local'],
  ['Corporate HR', 'corporate.hr@ars.local'],
  ['HOD-HR', 'hod.hr@ars.local'],
];

/** [company, department, position|null, approvedQuota, presentManpower] - illustrative figures, edit in the UI. */
const QUOTAS: [string, string, string | null, number | null, number | null][] = [
  ['HO', 'ICT', null, 20, 16],
  ['HO', 'ICT', 'Software Developer', 10, 8],
  ['HO', 'ICT', 'Executive', 4, 4],
  ['HO', 'ICT', 'Manager', 1, null],
  ['HO', 'ADMIN', null, 15, 14],
  ['HO', 'ADMIN', 'Asst. Executive', 6, 5],
  ['AJL', 'MED', null, 6, 5],
  ['AJL', 'MED', 'Nurse', 4, 3],
];

const TEMPLATES: { name: string; kind: EmailTemplate['kind']; subject: string; body: string }[] = [
  {
    name: 'Interview invitation (standard)', kind: 'INTERVIEW_INVITE',
    subject: 'Interview invitation - {{position}}, {{company}} ({{applicationId}})',
    body: `Dear {{candidateName}},

Thank you for applying for the position of {{position}} ({{department}}) at {{company}}.
We are pleased to invite you to an interview:

Date: {{interviewDate}}
Time: {{interviewTime}}
Venue: {{location}}

{{instructions}}

Please bring this email and your original certificates. Your application reference is {{applicationId}}.

Best regards,
HR & Recruitment
Ananta Companies`,
  },
  {
    name: 'Result - selected', kind: 'RESULT',
    subject: 'Congratulations - {{position}}, {{company}}',
    body: `Dear {{candidateName}},

Congratulations! We are pleased to inform you that you have been selected for the position of {{position}} ({{department}}) at {{company}}.

Our HR team will contact you shortly with joining details.

Best regards,
HR & Recruitment
Ananta Companies`,
  },
  {
    name: 'Result - not selected', kind: 'RESULT',
    subject: 'Your application for {{position}} ({{applicationId}})',
    body: `Dear {{candidateName}},

Thank you for your interest in the position of {{position}} at {{company}} and for the time you invested in our selection process.
After careful consideration we will not be moving forward with your application at this time. We will keep your CV for future opportunities.

Best regards,
HR & Recruitment
Ananta Companies`,
  },
  {
    // Adapted from "Offer Letter_Email draft.docx"
    name: 'Joining confirmation (offer email)', kind: 'JOINING_LETTER',
    subject: 'Joining confirmation - {{position}}, {{company}}',
    body: `Dear {{candidateName}},

Congratulations!
We are pleased to confirm your selection for the position of {{position}} - {{department}} at {{company}}. Your joining date is confirmed on {{joiningDate}}. The joining formalities will be completed at our Head Office. You are requested to report to the following address on your joining date at {{reportingTime}}.

Ananta Head Office: Building 20, Gareeb-e-Newaz Avenue, Sector 13, Uttara, Dhaka-1230.

Step 1: Complete the Joining Form (Biodata & Nominee) by the day before your joining date.
Step 2: Bring the following documents on your joining date:
- All educational certificates & mark-sheets (photocopy and original for verification)
- National ID card
- Citizenship certificate from local UP Chairman/Commissioner
- Four copies of colour passport-size photos
- Two copies of nominee's passport-size photos and a copy of nominee's NID
- Blood group report (not necessary if mentioned in NID)
- Training certificates (if any)
- ID card/Business card & NOC/Release letter from the previous company (not required for freshers)

Important: you are required to join on the date specified above; otherwise this offer will be considered void. If any information or document provided is found to be false, employment will be subject to immediate cancellation.

For assistance please contact {{contactPerson}}.

We look forward to welcoming you to the team.
HR & Recruitment, Ananta Companies`,
  },
];

export async function seed(ds: DataSource, log = console.log) {
  const m = ds.manager;
  for (const r of DEFAULT_ROLES) {
    const existing = await m.findOne(Role, { where: { code: r.code } });
    // Keep Super Admin edits to existing roles; only create missing roles (Super Admin always gets all permissions).
    if (!existing) await m.save(Role, m.create(Role, { ...r, active: r.active ?? true }));
    else if (r.code === 'SUPER_ADMIN') await m.update(Role, existing.id, { permissions: r.permissions });
  }
  // Starter permission templates, only on a fresh install (deleted templates are not brought back).
  if (!(await m.count(PermissionTemplate))) {
    const role = (code: string) => DEFAULT_ROLES.find((r) => r.code === code)!.permissions;
    await m.save(PermissionTemplate, [
      { name: 'HR Coordinator', description: "Recruitment of assigned vacancies; every department's requisitions and quotas (view).", permissions: role('HR_COORDINATOR'), departmentScopes: {} },
      { name: 'Department User - view only', description: "Own department's quotas, requisitions and joined candidates; no create or edit.", permissions: [P.MASTER_VIEW, P.QUOTA_VIEW, P.REQ_VIEW, P.JOINED_VIEW, P.DASHBOARD_DEPT], departmentScopes: {} },
      { name: 'Requisition Approver', description: 'Approver Inbox with final approval for every department.', permissions: role('ADMIN'), departmentScopes: {} },
    ].map((t) => m.create(PermissionTemplate, t)));
  }
  const upsert = async <T extends { code: string }>(Entity: any, rows: [string, string][]) => {
    for (const [code, name] of rows) if (!(await m.exists(Entity, { where: { code } }))) await m.insert(Entity, { code, name });
  };
  await upsert(Company, COMPANIES);
  await upsert(Department, DEPARTMENTS);
  for (const title of POSITIONS) if (!(await m.exists(Position, { where: { title } }))) await m.insert(Position, { title });

  const dept = async (code: string) => (await m.findOneByOrFail(Department, { code })).id;
  if (!config.seedPassword) throw new Error('SEED_PASSWORD is not set. Add it to backend/.env (see README).');
  const hash = await bcrypt.hash(config.seedPassword, 10);
  for (const [email, name, designation, dcode, roleCodes] of USERS) {
    if (await m.exists(User, { where: { email } })) continue;
    const roles = await Promise.all(roleCodes.map((code) => m.findOneByOrFail(Role, { code })));
    await m.save(User, m.create(User, { email, name, designation, passwordHash: hash, departmentId: dcode ? await dept(dcode) : null, roles }));
  }

  if (!(await m.exists(ApprovalRoute, { where: { departmentId: IsNull() } }))) {
    const route = m.create(ApprovalRoute, { name: 'Default Form No. 01 route (prototype - confirm order)', departmentId: null, active: true });
    route.steps = [];
    for (const [i, [label, email]] of ROUTE.entries()) {
      const u = await m.findOneByOrFail(User, { email });
      route.steps.push(m.create(ApprovalRouteStep, { stepOrder: i + 1, label, approverUserId: u.id, required: true }));
    }
    await m.save(route);
  }

  for (const [cc, dc, pos, quota, present] of QUOTAS) {
    const companyId = (await m.findOneByOrFail(Company, { code: cc })).id;
    const departmentId = await dept(dc);
    const positionId = pos ? (await m.findOneByOrFail(Position, { title: pos })).id : null;
    if (!(await m.exists(ManpowerQuota, { where: { companyId, departmentId, positionId: positionId ?? IsNull() } }))) {
      await m.insert(ManpowerQuota, { companyId, departmentId, positionId, approvedQuota: quota, presentManpower: present, remarks: 'Prototype seed figure' });
    }
  }

  for (const t of TEMPLATES) {
    if (await m.exists(EmailTemplate, { where: { name: t.name } })) continue;
    const saved = await m.save(EmailTemplate, m.create(EmailTemplate, { ...t, version: 1 }));
    await m.insert(EmailTemplateVersion, { templateId: saved.id, version: 1, subject: t.subject, body: t.body });
  }
  log(`Seed complete. ${USERS.length} prototype users (password = SEED_PASSWORD from .env).`);
}

if (require.main === module) {
  dataSource.initialize()
    .then(async (ds) => { await seed(ds); await ds.destroy(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
