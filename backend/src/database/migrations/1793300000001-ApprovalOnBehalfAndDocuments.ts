import { MigrationInterface, QueryRunner } from "typeorm";

export class ApprovalOnBehalfAndDocuments1793300000001 implements MigrationInterface {
    name = 'ApprovalOnBehalfAndDocuments1793300000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "requisition_attachments" ADD "approvalActionId" uuid`);
        await queryRunner.query(`ALTER TABLE "approval_actions" ADD "actedById" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_e43ed027f1458bad45bd13b172" ON "requisition_attachments"  ("approvalActionId") `);
        await queryRunner.query(`ALTER TABLE "approval_actions" ADD CONSTRAINT "FK_676020a201750124c392fce6c37" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "approval_actions" DROP CONSTRAINT "FK_676020a201750124c392fce6c37"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e43ed027f1458bad45bd13b172"`);
        await queryRunner.query(`ALTER TABLE "approval_actions" DROP COLUMN "actedById"`);
        await queryRunner.query(`ALTER TABLE "requisition_attachments" DROP COLUMN "approvalActionId"`);
    }

}
