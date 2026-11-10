import { P, Permission } from './permissions';

/** The standard actions shown as columns of the module-wise permission grid. */
export const MATRIX_ACTIONS = ['view', 'create', 'edit', 'submit', 'approve', 'reject', 'export', 'manage'] as const;
export type MatrixAction = (typeof MATRIX_ACTIONS)[number];

export const ACTION_LABELS: Record<MatrixAction, string> = {
  view: 'View', create: 'Create', edit: 'Edit', submit: 'Submit', approve: 'Approve', reject: 'Reject / Return', export: 'Export', manage: 'Manage',
};

/** Modules whose records belong to a department: each user gets Own / All / Custom departments for them. */
export const SCOPE_MODULES = ['dashboard', 'quotas', 'requisitions', 'joining'] as const;
export type ScopeModule = (typeof SCOPE_MODULES)[number];

export interface MatrixModule {
  key: string;
  label: string;
  /** Codes each action column toggles; an action a module does not have is simply absent. */
  actions: Partial<Record<MatrixAction, Permission[]>>;
  /** Module rights that are not one of the standard actions. */
  extras?: { code: Permission; label: string }[];
  scope?: { module: ScopeModule; note: string };
}

/**
 * Every permission code placed in a module and action, so the Users & Roles screen can show the catalogue as a grid.
 * Approve and Reject / Return share one permission (approval.act). The *_view_all_departments codes are the
 * role default for "All departments"; a per-user Access Scope overrides them.
 */
export const PERMISSION_MATRIX: MatrixModule[] = [
  {
    key: 'dashboard', label: 'Dashboard',
    actions: { view: [P.DASHBOARD_DEPT] },
    extras: [{ code: P.DASHBOARD_HR, label: 'HR recruitment section' }, { code: P.DASHBOARD_ADMIN, label: 'Admin requisitions section' }],
    scope: { module: 'dashboard', note: 'Department figures on the dashboard' },
  },
  {
    key: 'quotas', label: 'Positions & Quota',
    actions: { view: [P.QUOTA_VIEW], edit: [P.QUOTA_EDIT] },
    extras: [{ code: P.REQ_QUOTA_CHART, label: 'Insert approved quota into the quota chart' }, { code: P.QUOTA_VIEW_ALL, label: 'All departments by default (role)' }],
    scope: { module: 'quotas', note: 'Which departments\' positions & quotas the user sees and edits' },
  },
  {
    key: 'requisitions', label: 'Requisitions',
    actions: { view: [P.REQ_VIEW], create: [P.REQ_CREATE], edit: [P.REQ_EDIT], submit: [P.REQ_SUBMIT], manage: [P.REQ_MANAGE_ALL] },
    extras: [
      { code: P.REQ_CANCEL, label: 'Cancel requisition' }, { code: P.REQ_CORPORATE_HR, label: 'Corporate HR remarks' },
      { code: P.REQ_VIEW_ALL, label: 'All departments by default (role)' },
    ],
    scope: { module: 'requisitions', note: 'Which departments\' requisitions the user sees and raises' },
  },
  {
    key: 'approvals', label: 'Approver Inbox',
    actions: { view: [P.APPROVAL_ACT], approve: [P.APPROVAL_ACT], reject: [P.APPROVAL_ACT], manage: [P.ACT_ON_BEHALF] },
  },
  {
    key: 'hr_queue', label: 'HR Approved Queue',
    actions: { view: [P.HR_QUEUE], create: [P.VACANCY_CREATE], edit: [P.COORDINATOR_ASSIGN] },
  },
  {
    key: 'recruitment', label: 'Vacancies & Job Posts',
    actions: { view: [P.VACANCY_VIEW], create: [P.VACANCY_DIRECT], edit: [P.VACANCY_EDIT], manage: [P.RECRUITMENT_ALL] },
    extras: [{ code: P.JOBPOST_EDIT, label: 'Job posts & circulars' }],
  },
  {
    key: 'candidates', label: 'Candidates (CV Bank)',
    actions: { view: [P.CANDIDATE_VIEW], create: [P.CV_UPLOAD], edit: [P.CANDIDATE_EDIT], approve: [P.SHORTLIST], export: [P.EXPORT], manage: [P.CANDIDATE_MERGE] },
    extras: [
      { code: P.CV_DOWNLOAD, label: 'Open / download CV files' }, { code: P.SCREENING_RUN, label: 'Run screening' },
      { code: P.SHORTLIST_OVERRIDE, label: 'Override a Fail when shortlisting' },
      { code: P.CANDIDATE_DELETE, label: 'Delete selected CVs permanently' },
    ],
  },
  {
    key: 'interviews', label: 'Interview Board / Exams',
    actions: { edit: [P.MARKS_ENTER], create: [P.MARKS_IMPORT], approve: [P.FINAL_DECISION], manage: [P.MARKS_OVERWRITE] },
    extras: [{ code: P.ATTENDANCE, label: 'Record attendance' }],
  },
  {
    key: 'email', label: 'Recruitment Email & Templates',
    actions: { submit: [P.EMAIL_SEND], manage: [P.TEMPLATE_MANAGE] },
  },
  {
    key: 'joining', label: 'Joining',
    actions: { view: [P.JOINING_VIEW], approve: [P.JOINING_APPROVE] },
    extras: [{ code: P.JOINED_VIEW, label: 'Joined candidates list' }],
    scope: { module: 'joining', note: 'Joined candidates of which departments (department users)' },
  },
  { key: 'master', label: 'Master Data', actions: { view: [P.MASTER_VIEW], manage: [P.MASTER_CONFIGURE] } },
  { key: 'users', label: 'Users & Roles', actions: { manage: [P.USER_MANAGE] } },
  { key: 'approval_config', label: 'Approval Configuration', actions: { manage: [P.APPROVAL_ROUTE_CONFIGURE] } },
  { key: 'monitor', label: 'Processing Monitor', actions: { view: [P.MONITOR_VIEW], edit: [P.MONITOR_RETRY] } },
  { key: 'audit', label: 'Logs', actions: { view: [P.AUDIT_VIEW] } },
  { key: 'reports', label: 'Reports & Analytics', actions: { view: [P.REPORTS_VIEW] } },
];
