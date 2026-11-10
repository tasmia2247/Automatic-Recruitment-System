import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keyword match score (owner, 2026-11-08): each screening run stores a 0-100 score built from Required Skills, Key Responsibilities,
 * education and experience; the application keeps the latest one so candidates can be ranked by it.
 */
export class ScreeningMatchScore1793300000013 implements MigrationInterface {
  name = 'ScreeningMatchScore1793300000013';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE screening_runs ADD COLUMN IF NOT EXISTS "score" numeric(4,1)`);
    await q.query(`ALTER TABLE screening_runs ADD COLUMN IF NOT EXISTS "scoreParts" jsonb`);
    await q.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS "screeningScore" numeric(4,1)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE applications DROP COLUMN IF EXISTS "screeningScore"`);
    await q.query(`ALTER TABLE screening_runs DROP COLUMN IF EXISTS "scoreParts"`);
    await q.query(`ALTER TABLE screening_runs DROP COLUMN IF EXISTS "score"`);
  }
}
