import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Only Super Admin sees every department's quotas and requisitions; HR, Corporate HR and read-only users
 * now see their own department (approvers keep access to requisitions on their route, HR to the approved queue).
 */
export class DepartmentScopedViews1793300000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE roles SET permissions = array_remove(permissions, 'requisition.view_all_departments')
        WHERE code IN ('HR_RECRUITER', 'CORPORATE_HR', 'READ_ONLY')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE roles SET permissions = array_append(permissions, 'requisition.view_all_departments')
        WHERE code IN ('HR_RECRUITER', 'CORPORATE_HR', 'READ_ONLY')
          AND NOT ('requisition.view_all_departments' = ANY(permissions))`,
    );
  }
}
