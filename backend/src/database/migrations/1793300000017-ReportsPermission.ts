import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reports & Analytics (owner, 2026-11-09): new `report.view` permission for the /reports module. Grant it
 * to the roles that work with recruitment data by default — HR, HR Manager, Admin — matching DEFAULT_ROLES in
 * common/permissions.ts; Super Admin picks it up through its "all permissions" seed. Every other role is unchanged.
 */
const GRANTS: [string, string[]][] = [
  ['HR_RECRUITER', ['report.view']],
  ['HR_MANAGER', ['report.view']],
  ['ADMIN', ['report.view']],
];

export class ReportsPermission1793300000017 implements MigrationInterface {
  name = 'ReportsPermission1793300000017';

  public async up(q: QueryRunner): Promise<void> {
    for (const [code, add] of GRANTS) await this.add(q, code, add);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [code, add] of GRANTS) await this.remove(q, code, add);
  }

  private async add(q: QueryRunner, code: string, add: string[]) {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || $2::text[]) p ORDER BY p)
        WHERE code = $1`, [code, add]);
  }

  private async remove(q: QueryRunner, code: string, remove: string[]) {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(SELECT p FROM unnest(permissions) p WHERE NOT (p = ANY($2::text[])) ORDER BY p)
        WHERE code = $1`, [code, remove]);
  }
}
