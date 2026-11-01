import { Module } from '@nestjs/common';
import { RequisitionService } from './requisitions.service';
import { ApprovalsController, RequisitionsController } from './requisitions.controller';

@Module({
  controllers: [RequisitionsController, ApprovalsController],
  providers: [RequisitionService],
  exports: [RequisitionService],
})
export class RequisitionsModule {}
