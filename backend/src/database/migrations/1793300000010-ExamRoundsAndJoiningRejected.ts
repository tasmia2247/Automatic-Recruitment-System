import { MigrationInterface, QueryRunner } from 'typeorm';

const STAGE_TABLES = ['candidate_stages', 'evaluation_marks', 'import_batches'];

/**
 * Owner, 2026-11-04: the three marks are Written exam, Interview board (viva) and an Optional exam, so the old VIVA round
 * becomes OPTIONAL. A candidate turned down at joining is "Rejected" and stays listed (was "Did Not Join").
 */
export class ExamRoundsAndJoiningRejected1793300000010 implements MigrationInterface {
  name = 'ExamRoundsAndJoiningRejected1793300000010';

  public async up(q: QueryRunner): Promise<void> {
    for (const t of STAGE_TABLES) await q.query(`UPDATE "${t}" SET "stageType" = 'OPTIONAL' WHERE "stageType" = 'VIVA'`);
    await q.query(`UPDATE "joining_records" SET status = 'Rejected' WHERE status = 'Did Not Join'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE "joining_records" SET status = 'Did Not Join' WHERE status = 'Rejected'`);
    for (const t of STAGE_TABLES) await q.query(`UPDATE "${t}" SET "stageType" = 'VIVA' WHERE "stageType" = 'OPTIONAL'`);
  }
}
