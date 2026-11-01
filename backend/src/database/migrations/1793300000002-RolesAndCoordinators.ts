import { MigrationInterface, QueryRunner } from 'typeorm';

/** [role code, permissions to add, permissions to remove] - the Roles & Permissions specification defaults. */
const CHANGES: [string, string[], string[]][] = [
  ['DEPT_REQUESTER', ['joining.view_joined', 'dashboard.department'], []],
  // HR works only on the vacancies they coordinate; the HR queue and vacancy creation move to HR Manager.
  ['HR_RECRUITER', ['requisition.view_all_departments', 'quota.view_all_departments', 'joining.view_joined'],
    ['hr.queue', 'vacancy.create', 'vacancy.create_direct', 'monitor.retry']],
  // Non-HR recruitment roles keep seeing every vacancy, as before coordinators existed.
  ['CV_SCREENER', ['recruitment.view_all'], []],
  ['EXAMINER', ['recruitment.view_all'], []],
  ['READ_ONLY', ['recruitment.view_all', 'joining.view_joined'], []],
];

const NAMES: [string, string, string][] = [
  ['DEPT_REQUESTER', 'Department Requester', 'Department'],
  ['HR_RECRUITER', 'HR / Recruitment', 'HR'],
];

/**
 * HR coordinators: the HR Approved Queue assigns one coordinator per approved requisition / vacancy, and HR users
 * see only the vacancies they coordinate. New roles (HR Manager, Admin) are created by the seed.
 */
export class RolesAndCoordinators1793300000002 implements MigrationInterface {
  name = 'RolesAndCoordinators1793300000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "requisitions" ADD "coordinatorId" uuid`);
    await q.query(`ALTER TABLE "vacancies" ADD "coordinatorId" uuid`);
    await q.query(`CREATE INDEX "IDX_1677615a0ea8f1d0e765004238" ON "vacancies" ("coordinatorId") `);
    await q.query(`ALTER TABLE "requisitions" ADD CONSTRAINT "FK_6e35c7e11ad77e905ac9eaa75c1" FOREIGN KEY ("coordinatorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE "vacancies" ADD CONSTRAINT "FK_1677615a0ea8f1d0e7650042383" FOREIGN KEY ("coordinatorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    for (const [code, add, remove] of CHANGES) await this.change(q, code, add, remove);
    for (const [code, from, to] of NAMES) await q.query(`UPDATE roles SET name = $2 WHERE code = $1 AND name = $3`, [code, to, from]);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [code, from, to] of NAMES) await q.query(`UPDATE roles SET name = $2 WHERE code = $1 AND name = $3`, [code, from, to]);
    for (const [code, add, remove] of CHANGES) await this.change(q, code, remove, add);
    await q.query(`ALTER TABLE "vacancies" DROP CONSTRAINT "FK_1677615a0ea8f1d0e7650042383"`);
    await q.query(`ALTER TABLE "requisitions" DROP CONSTRAINT "FK_6e35c7e11ad77e905ac9eaa75c1"`);
    await q.query(`DROP INDEX "public"."IDX_1677615a0ea8f1d0e765004238"`);
    await q.query(`ALTER TABLE "vacancies" DROP COLUMN "coordinatorId"`);
    await q.query(`ALTER TABLE "requisitions" DROP COLUMN "coordinatorId"`);
  }

  private async change(q: QueryRunner, code: string, add: string[], remove: string[]) {
    await q.query(
      `UPDATE roles SET permissions = ARRAY(
         SELECT DISTINCT p FROM unnest(permissions || $2::text[]) p WHERE NOT (p = ANY($3::text[])) ORDER BY p)
        WHERE code = $1`, [code, add, remove]);
  }
}
