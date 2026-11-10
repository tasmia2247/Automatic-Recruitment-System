import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Follow-up to migration 017: `report.view` must also be granted to `SUPER_ADMIN`, so the role keeps its
 * "all permissions" guarantee without needing a fresh seed run. Idempotent via the array dedupe.
 */
export class ReportsPermissionSuperAdmin1793300000018 implements MigrationInterface {
  name = 'ReportsPermissionSuperAdmin1793300000018';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['report.view']::text[]) p ORDER BY p)
        WHERE code = 'SUPER_ADMIN'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(SELECT p FROM unnest(permissions) p WHERE p <> 'report.view' ORDER BY p)
        WHERE code = 'SUPER_ADMIN'`);
  }
}
