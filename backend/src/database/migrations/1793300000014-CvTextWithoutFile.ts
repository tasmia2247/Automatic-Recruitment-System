import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CV files are not kept (owner, 2026-11-08): once a CV has been read, its plain text (and the name hint from the PDF layout) is
 * stored on the document row and the file is deleted. The row keeps the file's name, size and SHA-256 so the same file is still
 * refused twice and duplicates are still found. A CV that could not be read keeps its file until HR has entered the data.
 */
export class CvTextWithoutFile1793300000014 implements MigrationInterface {
  name = 'CvTextWithoutFile1793300000014';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE candidate_documents ALTER COLUMN "storageKey" DROP NOT NULL`);
    await q.query(`ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS "textContent" text`);
    await q.query(`ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS "nameHint" varchar(200)`);
    await q.query(`ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS "fileRemovedAt" timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE candidate_documents DROP COLUMN IF EXISTS "fileRemovedAt"`);
    await q.query(`ALTER TABLE candidate_documents DROP COLUMN IF EXISTS "nameHint"`);
    await q.query(`ALTER TABLE candidate_documents DROP COLUMN IF EXISTS "textContent"`);
    // Rows whose file was removed cannot get it back; they keep an empty key.
    await q.query(`UPDATE candidate_documents SET "storageKey" = '' WHERE "storageKey" IS NULL`);
    await q.query(`ALTER TABLE candidate_documents ALTER COLUMN "storageKey" SET NOT NULL`);
  }
}
