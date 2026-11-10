import { MigrationInterface, QueryRunner } from 'typeorm';

/** The salary agreed for a selected candidate, entered on Joining Pending (owner, 2026-11-09); free text such as "45,000 per month". */
export class JoiningSalary1793300000016 implements MigrationInterface {
  name = 'JoiningSalary1793300000016';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE joining_records ADD COLUMN IF NOT EXISTS "salary" varchar(100)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE joining_records DROP COLUMN IF EXISTS "salary"`);
  }
}
