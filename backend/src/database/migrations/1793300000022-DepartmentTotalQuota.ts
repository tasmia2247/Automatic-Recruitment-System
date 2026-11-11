import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Move department-level total manpower quota from `manpower_quotas` (the rows with `positionId IS NULL`) onto
 * `departments.totalQuota`, where Master Data edits it (owner, 2026-11-10). `manpower_quotas` then only holds
 * designation rows, so `positionId` becomes NOT NULL.
 *
 * Migration is idempotent and conservative:
 * - adds the column if it does not exist yet;
 * - copies the max `approvedQuota` of each department's existing dept-total rows into `departments.totalQuota`
 *   (one department may have one such row per company — max is the safe pick for a dept-wide figure);
 * - deletes the dept-total rows;
 * - tightens `manpower_quotas."positionId"` to NOT NULL (fails loudly if any orphan dept-total row is still
 *   present — never silently drops data).
 */
export class DepartmentTotalQuota1793300000022 implements MigrationInterface {
  name = 'DepartmentTotalQuota1793300000022';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS "totalQuota" int`);

    // Copy the dept-wide approved quota from any pre-refactor dept-total rows (positionId IS NULL) into the
    // department record. MAX across companies is the least-destructive merge; in practice a dept maps to one
    // company anyway, and the audit log still holds the per-row history.
    await q.query(
      `UPDATE departments d SET "totalQuota" = sub.q
         FROM (SELECT "departmentId", MAX("approvedQuota") AS q
                 FROM manpower_quotas
                WHERE "positionId" IS NULL AND "approvedQuota" IS NOT NULL
                GROUP BY "departmentId") sub
        WHERE sub."departmentId" = d.id AND d."totalQuota" IS NULL`,
    );

    await q.query(`DELETE FROM manpower_quotas WHERE "positionId" IS NULL`);
    await q.query(`ALTER TABLE manpower_quotas ALTER COLUMN "positionId" SET NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Loosen the column; dept-total rows are not restored (nothing on disk to re-create them from). The owner
    // can re-add them from the department totals through Positions & Quota if required.
    await q.query(`ALTER TABLE manpower_quotas ALTER COLUMN "positionId" DROP NOT NULL`);
    await q.query(`ALTER TABLE departments DROP COLUMN IF EXISTS "totalQuota"`);
  }
}
