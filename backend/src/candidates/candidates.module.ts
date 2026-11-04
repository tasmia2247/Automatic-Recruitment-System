import { Module } from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { CandidatesController } from './candidates.controller';
import { MailIntakeService } from './mail-intake.service';

@Module({
  controllers: [CandidatesController],
  providers: [CandidatesService, MailIntakeService],
  exports: [CandidatesService],
})
export class CandidatesModule {}
