import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The CV submission method no longer names the job ID (owner, 2026-11-05): designation and department are enough.
 * Only posts that still carry the untouched old default ('Email CV with subject containing "JOB-..."') are rewritten to the
 * new default; text that HR typed is left alone.
 */
export class CvMethodWithoutJobId1793300000012 implements MigrationInterface {
  name = 'CvMethodWithoutJobId1793300000012';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE job_posts jp
      SET "cvCollection" = 'Email CV with subject "Application for ' || jp.title
        || CASE WHEN position(lower(d.name) in lower(jp.title)) > 0 THEN '' ELSE ' - ' || d.name END || '"'
      FROM vacancies v JOIN departments d ON d.id = v."departmentId"
      WHERE v.id = jp."vacancyId" AND jp."cvCollection" = 'Email CV with subject containing "' || jp."jobNo" || '"'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE job_posts jp
      SET "cvCollection" = 'Email CV with subject containing "' || jp."jobNo" || '"'
      FROM vacancies v JOIN departments d ON d.id = v."departmentId"
      WHERE v.id = jp."vacancyId" AND jp."cvCollection" = 'Email CV with subject "Application for ' || jp.title
        || CASE WHEN position(lower(d.name) in lower(jp.title)) > 0 THEN '' ELSE ' - ' || d.name END || '"'`);
  }
}
