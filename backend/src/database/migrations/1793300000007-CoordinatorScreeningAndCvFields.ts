import { MigrationInterface, QueryRunner } from 'typeorm';

/** Roles that saw every vacancy before the owner made recruitment coordinator-only (2026-11-04). */
const FULL_ACCESS_REMOVED = ['CV_SCREENER', 'EXAMINER', 'READ_ONLY'];

/**
 * - More CV fields for the vacancy table and the CV data Excel: address, certifications, previous jobs and designations.
 * - Screening now checks the requisition's "Specialization required" instead of job post criteria, so a screening run
 *   may have no criteria set; `basis` says which rules produced it.
 * - Only the coordinator, HR Manager and Super Admin see a vacancy: CV Screener, Examiner and Read-only lose recruitment.view_all.
 */
export class CoordinatorScreeningAndCvFields1793300000007 implements MigrationInterface {
  name = 'CoordinatorScreeningAndCvFields1793300000007';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "applications" ADD "address" text`);
    await q.query(`ALTER TABLE "applications" ADD "certifications" text`);
    await q.query(`ALTER TABLE "applications" ADD "previousJobs" text`);
    await q.query(`ALTER TABLE "screening_runs" ALTER COLUMN "criteriaSetId" DROP NOT NULL`);
    await q.query(`ALTER TABLE "screening_runs" ADD "basis" character varying(20) NOT NULL DEFAULT 'JOB_POST'`);
    await this.roles(q, [], ['recruitment.view_all']);
  }

  public async down(q: QueryRunner): Promise<void> {
    await this.roles(q, ['recruitment.view_all'], []);
    await q.query(`ALTER TABLE "screening_runs" DROP COLUMN "basis"`);
    // Fails while requisition-based runs exist; they are kept rather than deleted.
    await q.query(`ALTER TABLE "screening_runs" ALTER COLUMN "criteriaSetId" SET NOT NULL`);
    await q.query(`ALTER TABLE "applications" DROP COLUMN "previousJobs"`);
    await q.query(`ALTER TABLE "applications" DROP COLUMN "certifications"`);
    await q.query(`ALTER TABLE "applications" DROP COLUMN "address"`);
  }

  private async roles(q: QueryRunner, add: string[], remove: string[]) {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(
         SELECT DISTINCT p FROM unnest(permissions || $2::text[]) p WHERE NOT (p = ANY($3::text[])) ORDER BY p)
        WHERE code = ANY($1)`, [FULL_ACCESS_REMOVED, add, remove]);
  }
}
