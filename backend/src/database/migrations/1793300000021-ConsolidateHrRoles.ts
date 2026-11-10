import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Role catalog cleanup (owner, 2026-11-10). The business wants five end-user categories only — Super Admin,
 * Department Head, Admin, HR Manager and HR Coordinator (plus APPROVER kept silently for the approval chain).
 *
 * The old splinter roles (CORPORATE_HR, CV_SCREENER, EXAMINER, READ_ONLY) are kept on the books so existing
 * user assignments and audit entries still resolve, but marked `active = false` so they disappear from the
 * role pickers for new users. HR_RECRUITER is renamed to HR_COORDINATOR in place, and DEPT_REQUESTER is
 * renamed to "Department Head" for the business label.
 *
 * Idempotent: role codes are checked before updates, and HR_COORDINATOR is created only when HR_RECRUITER has
 * not been renamed already.
 */
export class ConsolidateHrRoles1793300000021 implements MigrationInterface {
  name = 'ConsolidateHrRoles1793300000021';

  public async up(q: QueryRunner): Promise<void> {
    // Rename HR_RECRUITER → HR_COORDINATOR in place (keeps the row id and every user_roles row intact).
    // Guarded so re-running after a manual edit does not clobber a hand-crafted HR_COORDINATOR row.
    await q.query(
      `DO $$
       DECLARE old_id uuid; new_id uuid;
       BEGIN
         SELECT id INTO old_id FROM roles WHERE code = 'HR_RECRUITER';
         SELECT id INTO new_id FROM roles WHERE code = 'HR_COORDINATOR';
         IF old_id IS NOT NULL AND new_id IS NULL THEN
           UPDATE roles SET code = 'HR_COORDINATOR', name = 'HR Coordinator',
                            description = 'Recruitment of assigned vacancies end to end: CV intake, screening, interviews, selection, joining; every department''s requisitions and quotas in view.'
            WHERE id = old_id;
         ELSIF old_id IS NOT NULL AND new_id IS NOT NULL THEN
           -- Both exist: fold HR_RECRUITER users into HR_COORDINATOR and drop the old row.
           INSERT INTO user_roles ("userId", "roleId")
             SELECT "userId", new_id FROM user_roles WHERE "roleId" = old_id
             ON CONFLICT DO NOTHING;
           DELETE FROM user_roles WHERE "roleId" = old_id;
           DELETE FROM roles WHERE id = old_id;
         END IF;
       END $$;`);

    // Rename DEPT_REQUESTER display to "Department Head" (code unchanged so every permission check keeps working).
    await q.query(
      `UPDATE roles SET name = 'Department Head',
         description = 'Head of a department: own department''s positions & quota, requisitions and their status, joined candidates.'
         WHERE code = 'DEPT_REQUESTER'`);

    // Mark the splinter roles inactive so UI pickers hide them while existing assignments stay valid.
    await q.query(`UPDATE roles SET active = false WHERE code IN ('CORPORATE_HR', 'CV_SCREENER', 'EXAMINER', 'READ_ONLY')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Mostly a presentation change; reversing just reinstates the old names and re-activates the splinter roles.
    await q.query(`UPDATE roles SET active = true WHERE code IN ('CORPORATE_HR', 'CV_SCREENER', 'EXAMINER', 'READ_ONLY')`);
    await q.query(`UPDATE roles SET name = 'Department', description = 'Own department: positions & quota, requisitions and their status, joined candidates.' WHERE code = 'DEPT_REQUESTER'`);
    await q.query(`UPDATE roles SET code = 'HR_RECRUITER', name = 'HR' WHERE code = 'HR_COORDINATOR'`);
  }
}
