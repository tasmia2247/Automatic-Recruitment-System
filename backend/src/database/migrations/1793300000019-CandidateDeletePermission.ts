import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `candidate.delete` to SUPER_ADMIN so it keeps its "all permissions" guarantee without needing
 * a fresh seed run. Super Admin uses the CV bank's bulk delete to permanently remove selected CVs,
 * their applications and orphaned candidates (owner, 2026-11-09). Idempotent via the array dedupe.
 */
export class CandidateDeletePermission1793300000019 implements MigrationInterface {
  name = 'CandidateDeletePermission1793300000019';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['candidate.delete']::text[]) p ORDER BY p)
        WHERE code = 'SUPER_ADMIN'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(SELECT p FROM unnest(permissions) p WHERE p <> 'candidate.delete' ORDER BY p)
        WHERE code = 'SUPER_ADMIN'`);
  }
}
