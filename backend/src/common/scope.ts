import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from './auth';
import type { ScopeModule } from './permission-matrix';
import { P, Permission } from './permissions';

/** Role default for each module when the user has no Access Scope of their own: this permission means All departments. */
export const ALL_BY_DEFAULT: Record<ScopeModule, Permission> = {
  dashboard: P.QUOTA_VIEW_ALL, quotas: P.QUOTA_VIEW_ALL, requisitions: P.REQ_VIEW_ALL, joining: P.RECRUITMENT_ALL,
};

/**
 * Department scope enforced server-side (SRS 3.1): null = all departments, otherwise the department IDs the user may see.
 * The user's Access Scope for the module wins (Own / All / Custom departments); without one the role decides.
 */
export function departmentScope(user: AuthUser, module: ScopeModule): string[] | null {
  const scope = resolveScope(user, module);
  if (scope === undefined) throw new ForbiddenException('Your account is not assigned to a department.');
  return scope;
}

/** Like departmentScope, but `undefined` (instead of an error) when "own department" applies and the user has none. */
export function resolveScope(user: AuthUser, module: ScopeModule): string[] | null | undefined {
  const s = user.scopes?.[module];
  const mode = s?.mode ?? (user.permissions.has(ALL_BY_DEFAULT[module]) ? 'all' : 'own');
  if (mode === 'all') return null;
  if (mode === 'custom') return s?.departmentIds ?? [];
  return user.departmentId ? [user.departmentId] : undefined;
}

export const inScope = (scope: string[] | null | undefined, departmentId: string) => scope === null || !!scope?.includes(departmentId);

export function assertDepartmentAccess(user: AuthUser, departmentId: string, module: ScopeModule) {
  if (!inScope(departmentScope(user, module), departmentId)) throw new ForbiddenException('This record belongs to another department.');
}

/**
 * Coordinator scope for recruitment data (vacancies, job posts, CVs, applications, evaluation, joining):
 * null = every vacancy (RECRUITMENT_ALL); otherwise only vacancies whose coordinator is this user.
 */
export function coordinatorScope(user: AuthUser): string | null {
  return user.permissions.has(P.RECRUITMENT_ALL) ? null : user.id;
}

const NOT_ASSIGNED = 'You are not the coordinator of this vacancy.';
type Db = DataSource | EntityManager;

/** Throws unless the user may work on this vacancy; 404 for unknown vacancies. */
export async function assertVacancyAccess(db: Db, user: AuthUser, vacancyId: string) {
  const [v] = await db.query(`SELECT "coordinatorId" FROM vacancies WHERE id = $1`, [vacancyId]);
  if (!v) throw new NotFoundException('Vacancy not found.');
  const scope = coordinatorScope(user);
  if (scope && v.coordinatorId !== scope) throw new ForbiddenException(NOT_ASSIGNED);
}

/** Same check for a record that belongs to a vacancy, looked up by `sql` returning its "vacancyId". */
async function assertVia(db: Db, user: AuthUser, sql: string, id: string, label: string) {
  if (!coordinatorScope(user)) return;
  const [row] = await db.query(sql, [id]);
  if (!row) throw new NotFoundException(`${label} not found.`);
  await assertVacancyAccess(db, user, row.vacancyId);
}

export const assertJobPostAccess = (db: Db, user: AuthUser, id: string) =>
  assertVia(db, user, `SELECT "vacancyId" FROM job_posts WHERE id = $1`, id, 'Job post');
export const assertApplicationAccess = (db: Db, user: AuthUser, id: string) =>
  assertVia(db, user, `SELECT "vacancyId" FROM applications WHERE id = $1`, id, 'Application');
export const assertDocumentAccess = (db: Db, user: AuthUser, id: string) =>
  assertVia(db, user, `SELECT a."vacancyId" FROM candidate_documents d JOIN applications a ON a.id = d."applicationId" WHERE d.id = $1`, id, 'Document');
export const assertImportAccess = (db: Db, user: AuthUser, id: string) =>
  assertVia(db, user, `SELECT "vacancyId" FROM import_batches WHERE id = $1`, id, 'Import');
export const assertJoiningAccess = (db: Db, user: AuthUser, id: string) =>
  assertVia(db, user, `SELECT a."vacancyId" FROM joining_records j JOIN applications a ON a.id = j."applicationId" WHERE j.id = $1`, id, 'Joining record');

/** Every listed application must belong to a vacancy this user may work on. */
export async function assertApplicationsAccess(db: Db, user: AuthUser, ids: string[]) {
  const scope = coordinatorScope(user);
  if (!scope || !ids.length) return;
  const [r] = await db.query(
    `SELECT count(*)::int AS n FROM applications a JOIN vacancies v ON v.id = a."vacancyId"
      WHERE a.id = ANY($1) AND v."coordinatorId" IS DISTINCT FROM $2`, [ids, scope]);
  if (r.n) throw new ForbiddenException(NOT_ASSIGNED);
}

/** Vacancy = approved quota - present manpower, with data-quality flags instead of misleading numbers (SRS 5.2). */
export function computeVacancy(quota: number | null | undefined, present: number | null | undefined) {
  if (quota === null || quota === undefined || present === null || present === undefined) {
    return { value: null as number | null, flag: 'Not available' as string | null };
  }
  const value = quota - present;
  if (value < 0) return { value, flag: 'Needs review: present manpower exceeds quota' };
  return { value, flag: null };
}
