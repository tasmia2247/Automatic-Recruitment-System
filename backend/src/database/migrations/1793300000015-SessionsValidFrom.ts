import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sign-out ends the session (security test, 2026-11-09): tokens issued before `users.sessionsValidFrom` are refused. Set on sign-out
 * and when an administrator sets a new password. Before this, a token copied from a browser stayed valid until it expired (8 h).
 */
export class SessionsValidFrom1793300000015 implements MigrationInterface {
  name = 'SessionsValidFrom1793300000015';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "sessionsValidFrom" timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS "sessionsValidFrom"`);
  }
}
