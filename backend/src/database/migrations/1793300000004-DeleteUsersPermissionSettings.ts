import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteUsersPermissionSettings1793300000004 implements MigrationInterface {
    name = 'DeleteUsersPermissionSettings1793300000004'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`CREATE TABLE "permission_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(20) NOT NULL, "key" character varying(80) NOT NULL, "label" character varying(120), "description" text, "disabled" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_c013dc571f3087fe1e5eede20a5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_249bf6538955eda2ec964bda5b" ON "permission_settings"  ("kind", "key") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_78ca3a129ee713cf4082cb89fd" ON "users"  ("email") WHERE "deletedAt" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_78ca3a129ee713cf4082cb89fd"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_249bf6538955eda2ec964bda5b"`);
        await queryRunner.query(`DROP TABLE "permission_settings"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" USING btree ("email") `);
    }

}
