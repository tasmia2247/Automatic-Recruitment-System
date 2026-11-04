import { MigrationInterface, QueryRunner } from "typeorm";

export class ApplicationLastPositionSpecialization1793300000006 implements MigrationInterface {
    name = 'ApplicationLastPositionSpecialization1793300000006'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" ADD "specialization" text`);
        await queryRunner.query(`ALTER TABLE "applications" ADD "lastPosition" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "lastPosition"`);
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "specialization"`);
    }

}
