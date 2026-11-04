import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Direct HR vacancies have no requisition, so they carry their own "Specialization required" for screening (owner, 2026-11-04).
 * `specializationVersion` goes up on every change, so a screening run records which wording it used.
 */
export class DirectVacancySpecialization1793300000008 implements MigrationInterface {
  name = 'DirectVacancySpecialization1793300000008';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vacancies" ADD "specialization" text`);
    await q.query(`ALTER TABLE "vacancies" ADD "specializationVersion" integer NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vacancies" DROP COLUMN "specializationVersion"`);
    await q.query(`ALTER TABLE "vacancies" DROP COLUMN "specialization"`);
  }
}
