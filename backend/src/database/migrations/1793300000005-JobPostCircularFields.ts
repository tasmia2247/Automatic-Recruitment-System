import { MigrationInterface, QueryRunner } from "typeorm";

export class JobPostCircularFields1793300000005 implements MigrationInterface {
    name = 'JobPostCircularFields1793300000005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "location" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "employmentType" character varying(60)`);
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "jobShift" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "salary" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "skills" text`);
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "applyEmail" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "job_posts" ADD "emailSubject" character varying(300)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "emailSubject"`);
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "applyEmail"`);
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "skills"`);
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "salary"`);
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "jobShift"`);
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "employmentType"`);
        await queryRunner.query(`ALTER TABLE "job_posts" DROP COLUMN "location"`);
    }

}
