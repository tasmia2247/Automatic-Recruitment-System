'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

export interface Me {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  roles: { code: string; name: string }[];
}

/** Departments the user may see per department-owned module: null = all departments. */
export type Scopes = Partial<Record<'dashboard' | 'quotas' | 'requisitions' | 'joining', string[] | null>>;

interface AuthState {
  user: Me | null;
  permissions: Set<string>;
  scopes: Scopes;
  loading: boolean;
  can: (...perms: string[]) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState<Scopes>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me; permissions: string[]; scopes: Scopes }>('/auth/me');
      setUser(r.user);
      setPermissions(new Set(r.permissions));
      setScopes(r.scopes ?? {});
    } catch {
      setUser(null);
      setPermissions(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }, []);

  // UI-only convenience: the API enforces every permission again server-side.
  const can = useCallback((...perms: string[]) => perms.every((p) => permissions.has(p)), [permissions]);

  return <Ctx.Provider value={{ user, permissions, scopes, loading, can, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** Permission codes mirrored from the API (backend/src/common/permissions.ts). */
export const P = {
  MASTER_CONFIGURE: 'master.configure', QUOTA_VIEW: 'quota.view', QUOTA_EDIT: 'quota.edit', QUOTA_VIEW_ALL: 'quota.view_all_departments',
  REQ_VIEW: 'requisition.view', REQ_VIEW_ALL: 'requisition.view_all_departments', REQ_CREATE: 'requisition.create',
  REQ_EDIT: 'requisition.edit', REQ_SUBMIT: 'requisition.submit', REQ_CANCEL: 'requisition.cancel', REQ_MANAGE_ALL: 'requisition.manage_all',
  REQ_CORPORATE_HR: 'requisition.corporate_hr_remarks', REQ_QUOTA_CHART: 'requisition.quota_chart',
  APPROVAL_ACT: 'approval.act', ACT_ON_BEHALF: 'approval.act_on_behalf', APPROVAL_ROUTE_CONFIGURE: 'approval.configure_route',
  HR_QUEUE: 'hr.queue', COORDINATOR_ASSIGN: 'hr.assign_coordinator', RECRUITMENT_ALL: 'recruitment.view_all', VACANCY_VIEW: 'vacancy.view', VACANCY_CREATE: 'vacancy.create', VACANCY_DIRECT: 'vacancy.create_direct',
  VACANCY_EDIT: 'vacancy.edit', JOBPOST_EDIT: 'jobpost.edit',
  CANDIDATE_VIEW: 'candidate.view', CANDIDATE_EDIT: 'candidate.edit', CV_UPLOAD: 'cv.upload', CV_DOWNLOAD: 'cv.download',
  CANDIDATE_MERGE: 'candidate.duplicate_review', CANDIDATE_DELETE: 'candidate.delete', SCREENING_RUN: 'screening.run', EXPORT: 'report.export',
  SHORTLIST: 'selection.shortlist', SHORTLIST_OVERRIDE: 'selection.override',
  ATTENDANCE: 'evaluation.attendance', MARKS_ENTER: 'evaluation.marks', MARKS_IMPORT: 'evaluation.import', MARKS_OVERWRITE: 'evaluation.overwrite',
  FINAL_DECISION: 'selection.final_decision', EMAIL_SEND: 'email.send', TEMPLATE_MANAGE: 'email.manage_template',
  JOINING_VIEW: 'joining.view', JOINED_VIEW: 'joining.view_joined', JOINING_APPROVE: 'joining.approve',
  USER_MANAGE: 'admin.users', AUDIT_VIEW: 'audit.view', MONITOR_VIEW: 'monitor.view', MONITOR_RETRY: 'monitor.retry', DASHBOARD_HR: 'dashboard.hr',
  DASHBOARD_DEPT: 'dashboard.department', DASHBOARD_ADMIN: 'dashboard.admin',
  REPORTS_VIEW: 'report.view',
} as const;
