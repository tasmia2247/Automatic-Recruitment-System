import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Specialization required" becomes four fields (owner, 2026-11-05): Education / Qualification, Skills, Minimum experience (years)
 * and Other requirements. The existing `specialization` column keeps its text as "Other requirements", so nothing already written
 * is lost. The JD stays free text for roles and responsibilities and is not used for screening.
 */
export class StructuredSpecialization1793300000011 implements MigrationInterface {
  name = 'StructuredSpecialization1793300000011';

  public async up(q: QueryRunner): Promise<void> {
    for (const t of ['requisitions', 'vacancies']) {
      await q.query(`ALTER TABLE "${t}" ADD "requiredEducation" text`);
      await q.query(`ALTER TABLE "${t}" ADD "requiredSkills" text`);
      await q.query(`ALTER TABLE "${t}" ADD "requiredExperienceYears" numeric(4,1)`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['requisitions', 'vacancies']) {
      await q.query(`ALTER TABLE "${t}" DROP COLUMN "requiredExperienceYears"`);
      await q.query(`ALTER TABLE "${t}" DROP COLUMN "requiredSkills"`);
      await q.query(`ALTER TABLE "${t}" DROP COLUMN "requiredEducation"`);
    }
  }
}
