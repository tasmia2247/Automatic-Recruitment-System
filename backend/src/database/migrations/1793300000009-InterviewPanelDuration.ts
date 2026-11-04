import { MigrationInterface, QueryRunner } from 'typeorm';

/** Interview Board (owner, 2026-11-04): each written exam / interview / viva slot records its panel and how long it lasts. */
export class InterviewPanelDuration1793300000009 implements MigrationInterface {
  name = 'InterviewPanelDuration1793300000009';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "candidate_stages" ADD "panel" text`);
    await q.query(`ALTER TABLE "candidate_stages" ADD "durationMinutes" integer`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "candidate_stages" DROP COLUMN "durationMinutes"`);
    await q.query(`ALTER TABLE "candidate_stages" DROP COLUMN "panel"`);
  }
}
