import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data fix: a vacancy that was marked `Filled` but no longer has `headcount` approved joinings
 * (candidates got rejected at joining, requisitions were corrected, etc.) stays Filled forever,
 * which made Mail Scan and CV upload refuse new CVs even when no one actually joined any more
 * (owner, 2026-11-09). Revert any such stale row to `Screening`. From now on `joining.service`
 * reverts it on reject/reopen too, so this is a one-shot reconciliation.
 */
export class ReconcileFilledVacancies1793300000020 implements MigrationInterface {
  name = 'ReconcileFilledVacancies1793300000020';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE vacancies v
          SET status = 'Screening'
        WHERE v.status = 'Filled'
          AND (SELECT count(*) FROM joining_records jr
                 JOIN applications a ON a.id = jr."applicationId"
                WHERE a."vacancyId" = v.id AND jr.status = 'Approved') < v.headcount`);
  }

  public async down(): Promise<void> {
    // No-op: the forward fix is a reconciliation; it cannot be undone meaningfully.
  }
}
