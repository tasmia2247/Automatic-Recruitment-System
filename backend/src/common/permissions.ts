/**
 * Permission catalog (SRS 3.1). Codes are `<module>.<action>`.
 * Roles hold lists of these codes; users may have extra/denied overrides.
 */
export const P = {
  // Master data / manpower
  MASTER_VIEW: 'master.view',
  MASTER_CONFIGURE: 'master.configure',
  QUOTA_VIEW: 'quota.view',
  QUOTA_EDIT: 'quota.edit',
  /** Every department's positions & quotas (HR, Super Admin); everyone else sees their own department. */
  QUOTA_VIEW_ALL: 'quota.view_all_departments',
  // Requisitions
  REQ_VIEW: 'requisition.view',
  /** Every department's requisitions (HR, Admin, Super Admin); everyone else sees their own department. */
  REQ_VIEW_ALL: 'requisition.view_all_departments',
  REQ_CREATE: 'requisition.create',
  REQ_EDIT: 'requisition.edit',
  REQ_SUBMIT: 'requisition.submit',
  REQ_CANCEL: 'requisition.cancel',
  /** Edit/submit any department's requisition on its requester's behalf (Super Admin). */
  REQ_MANAGE_ALL: 'requisition.manage_all',
  REQ_CORPORATE_HR: 'requisition.corporate_hr_remarks',
  REQ_QUOTA_CHART: 'requisition.quota_chart',
  // Approvals
  APPROVAL_ACT: 'approval.act',
  /** Final approval authority: decide any pending step for its named approver; one approval completes the route (Admin, Super Admin). */
  ACT_ON_BEHALF: 'approval.act_on_behalf',
  APPROVAL_ROUTE_CONFIGURE: 'approval.configure_route',
  // HR recruitment
  HR_QUEUE: 'hr.queue',
  /** Assign the HR coordinator of an approved requisition / vacancy (HR Manager, Super Admin). */
  COORDINATOR_ASSIGN: 'hr.assign_coordinator',
  /** Every vacancy's CVs and recruitment actions; without it HR users only see vacancies they coordinate. */
  RECRUITMENT_ALL: 'recruitment.view_all',
  VACANCY_VIEW: 'vacancy.view',
  VACANCY_CREATE: 'vacancy.create',
  VACANCY_DIRECT: 'vacancy.create_direct',
  VACANCY_EDIT: 'vacancy.edit',
  JOBPOST_EDIT: 'jobpost.edit',
  // Candidates
  CANDIDATE_VIEW: 'candidate.view',
  CANDIDATE_EDIT: 'candidate.edit',
  CV_UPLOAD: 'cv.upload',
  CV_DOWNLOAD: 'cv.download',
  CANDIDATE_MERGE: 'candidate.duplicate_review',
  SCREENING_RUN: 'screening.run',
  EXPORT: 'report.export',
  SHORTLIST: 'selection.shortlist',
  SHORTLIST_OVERRIDE: 'selection.override',
  // Evaluation
  ATTENDANCE: 'evaluation.attendance',
  MARKS_ENTER: 'evaluation.marks',
  MARKS_IMPORT: 'evaluation.import',
  MARKS_OVERWRITE: 'evaluation.overwrite',
  FINAL_DECISION: 'selection.final_decision',
  // Communication
  EMAIL_SEND: 'email.send',
  TEMPLATE_MANAGE: 'email.manage_template',
  // Joining
  JOINING_VIEW: 'joining.view',
  /** Joined Candidates list (own department for department users). */
  JOINED_VIEW: 'joining.view_joined',
  JOINING_APPROVE: 'joining.approve',
  // Administration
  USER_MANAGE: 'admin.users',
  AUDIT_VIEW: 'audit.view',
  MONITOR_VIEW: 'monitor.view',
  MONITOR_RETRY: 'monitor.retry',
  DASHBOARD_DEPT: 'dashboard.department',
  DASHBOARD_HR: 'dashboard.hr',
  DASHBOARD_ADMIN: 'dashboard.admin',
} as const;

export type Permission = (typeof P)[keyof typeof P];
export const ALL_PERMISSIONS: Permission[] = Object.values(P);

/** HR user: works only on the vacancies they are coordinator of (no HR queue, no vacancy creation). */
const HR_CORE: Permission[] = [
  P.MASTER_VIEW, P.QUOTA_VIEW, P.QUOTA_VIEW_ALL, P.REQ_VIEW, P.REQ_VIEW_ALL, P.VACANCY_VIEW, P.VACANCY_EDIT, P.JOBPOST_EDIT,
  P.CANDIDATE_VIEW, P.CANDIDATE_EDIT, P.CV_UPLOAD, P.CV_DOWNLOAD, P.CANDIDATE_MERGE, P.SCREENING_RUN, P.EXPORT, P.SHORTLIST,
  P.SHORTLIST_OVERRIDE, P.ATTENDANCE, P.MARKS_ENTER, P.MARKS_IMPORT, P.MARKS_OVERWRITE, P.FINAL_DECISION, P.EMAIL_SEND,
  P.TEMPLATE_MANAGE, P.JOINING_VIEW, P.JOINED_VIEW, P.JOINING_APPROVE, P.MONITOR_VIEW, P.DASHBOARD_HR,
];

/** Roles whose active members can be chosen as a vacancy's HR coordinator. */
export const COORDINATOR_ROLES = ['HR_RECRUITER', 'HR_MANAGER'];

/** Default role matrix (Roles & Permissions specification). Super Admin can edit role permissions at runtime. */
export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    code: 'DEPT_REQUESTER', name: 'Department',
    description: 'Own department: positions & quota, requisitions and their status, joined candidates.',
    permissions: [P.MASTER_VIEW, P.QUOTA_VIEW, P.QUOTA_EDIT, P.REQ_VIEW, P.REQ_CREATE, P.REQ_EDIT, P.REQ_SUBMIT, P.REQ_CANCEL, P.JOINED_VIEW, P.DASHBOARD_DEPT],
  },
  {
    code: 'HR_RECRUITER', name: 'HR',
    description: 'Recruitment of the vacancies assigned to them as coordinator; all requisitions and quotas (view).',
    permissions: HR_CORE,
  },
  {
    code: 'HR_MANAGER', name: 'HR Manager',
    description: 'HR Approved Queue, coordinator assignment, vacancy creation; monitors every vacancy and coordinator.',
    permissions: [...HR_CORE, P.HR_QUEUE, P.COORDINATOR_ASSIGN, P.RECRUITMENT_ALL, P.VACANCY_CREATE, P.VACANCY_DIRECT, P.MONITOR_RETRY, P.AUDIT_VIEW],
  },
  {
    code: 'ADMIN', name: 'Admin',
    description: 'Views all requisitions; approves, returns or rejects them from the Approver Inbox (one approval is final).',
    permissions: [P.MASTER_VIEW, P.REQ_VIEW, P.REQ_VIEW_ALL, P.APPROVAL_ACT, P.ACT_ON_BEHALF, P.DASHBOARD_ADMIN],
  },
  {
    code: 'APPROVER', name: 'Designated Requisition Approver',
    description: 'Review assigned approval tasks (Concerned Director / HR / AD-ED / Corporate HR / HOD-HR).',
    permissions: [P.MASTER_VIEW, P.APPROVAL_ACT],
  },
  {
    code: 'CORPORATE_HR', name: 'Corporate HR',
    description: 'Approval sign-off, corporate remarks and quota-chart status.',
    permissions: [P.MASTER_VIEW, P.QUOTA_VIEW, P.APPROVAL_ACT, P.REQ_VIEW, P.REQ_CORPORATE_HR, P.REQ_QUOTA_CHART],
  },
  {
    code: 'CV_SCREENER', name: 'CV Screening User',
    description: 'Review extracted fields, screening results and candidate remarks.',
    permissions: [P.VACANCY_VIEW, P.CANDIDATE_VIEW, P.CANDIDATE_EDIT, P.CV_DOWNLOAD, P.SCREENING_RUN],
  },
  {
    code: 'EXAMINER', name: 'Interview / Examiner',
    description: 'Attendance and exam/interview/viva marks.',
    permissions: [P.VACANCY_VIEW, P.CANDIDATE_VIEW, P.CV_DOWNLOAD, P.ATTENDANCE, P.MARKS_ENTER, P.MARKS_IMPORT],
  },
  {
    code: 'READ_ONLY', name: 'Read-only User',
    description: 'View authorized records and reports; no create/edit/approve.',
    permissions: [P.MASTER_VIEW, P.QUOTA_VIEW, P.REQ_VIEW, P.VACANCY_VIEW, P.CANDIDATE_VIEW, P.JOINING_VIEW, P.JOINED_VIEW, P.DASHBOARD_HR],
  },
  {
    code: 'SUPER_ADMIN', name: 'Super Admin',
    description: 'Everything: users, roles, master data, approval routes, settings, monitoring and audit logs.',
    permissions: ALL_PERMISSIONS,
  },
];
