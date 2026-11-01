import { MigrationInterface, QueryRunner } from "typeorm";

export class UserScopesAndTemplates1793300000003 implements MigrationInterface {
    name = 'UserScopesAndTemplates1793300000003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "permission_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "description" text, "permissions" text array NOT NULL DEFAULT '{}', "departmentScopes" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_58491c665954fb0fc0f0378e677" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6581c81a2a50703a5d0ea24435" ON "permission_templates"  ("name") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "departmentScopes" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "departmentScopes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6581c81a2a50703a5d0ea24435"`);
        await queryRunner.query(`DROP TABLE "permission_templates"`);
    }

}
