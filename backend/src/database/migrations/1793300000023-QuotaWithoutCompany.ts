import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the `companyId` dimension from `manpower_quotas` (owner, 2026-11-10). Quotas are now a per-department
 * / designation master figure, same across attached companies. Rows that duplicate a (department, position)
 * pair across companies are merged in place: MAX(approvedQuota) wins and SUM(presentManpower) is kept so no
 * joined candidates are lost from the running total.
 *
 * Idempotent: guards check whether the column still exists before touching it, so a re-run on an already
 * migrated database is a no-op.
 */
export class QuotaWithoutCompany1793300000023 implements MigrationInterface {
  name = 'QuotaWithoutCompany1793300000023';

  public async up(q: QueryRunner): Promise<void> {
    const [{ exists }] = await q.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'manpower_quotas' AND column_name = 'companyId') AS exists`);
    if (!exists) return;

    // Merge any (departmentId, positionId) duplicates into a single row before dropping the column.
    // Rule: keep the row with the smallest id for each pair, overwrite its approvedQuota with the MAX across
    // the pair, and its presentManpower with the SUM across the pair; then delete the other rows of the pair.
    // Postgres has no min(uuid), so pick the "keep" row with array_agg(... ORDER BY id::text).
    await q.query(
      `WITH merged AS (
         SELECT "departmentId", "positionId",
                (array_agg(id ORDER BY id::text))[1] AS keep_id,
                MAX("approvedQuota") AS q,
                SUM(COALESCE("presentManpower", 0))::int AS p,
                BOOL_OR("presentManpower" IS NOT NULL) AS has_present
           FROM manpower_quotas
          GROUP BY "departmentId", "positionId")
       UPDATE manpower_quotas m SET "approvedQuota" = merged.q,
                                    "presentManpower" = CASE WHEN merged.has_present THEN merged.p ELSE NULL END
         FROM merged
        WHERE m.id = merged.keep_id`);
    await q.query(
      `DELETE FROM manpower_quotas m
        USING (SELECT "departmentId", "positionId", (array_agg(id ORDER BY id::text))[1] AS keep_id
                 FROM manpower_quotas GROUP BY "departmentId", "positionId") merged
        WHERE m."departmentId" = merged."departmentId" AND m."positionId" = merged."positionId" AND m.id <> merged.keep_id`);

    // Drop the old composite unique index, the companyId FK and column, then recreate the unique index.
    await q.query(`DROP INDEX IF EXISTS "IDX_8f0da166e5cbc6541ca87c6491"`);
    await q.query(`ALTER TABLE manpower_quotas DROP CONSTRAINT IF EXISTS "FK_8e4e20f0a82acfb09487eb97bf3"`);
    await q.query(`ALTER TABLE manpower_quotas DROP COLUMN "companyId"`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_manpower_quotas_dept_position"
         ON manpower_quotas ("departmentId", "positionId")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Loosen it back: re-add the column nullable, drop the new unique, restore the old composite. Row-level
    // data cannot be un-merged — once the rows are merged the per-company split is gone.
    const [{ exists }] = await q.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'manpower_quotas' AND column_name = 'companyId') AS exists`);
    if (exists) return;
    await q.query(`ALTER TABLE manpower_quotas ADD COLUMN "companyId" uuid`);
    await q.query(`DROP INDEX IF EXISTS "IDX_manpower_quotas_dept_position"`);
    await q.query(`CREATE UNIQUE INDEX "IDX_8f0da166e5cbc6541ca87c6491"
                     ON manpower_quotas ("companyId", "departmentId", "positionId")`);
  }
}
