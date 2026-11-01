import { Module } from '@nestjs/common';
import { CandidatesModule } from '../candidates/candidates.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { JoiningModule } from '../joining/joining.module';
import { CvBankService } from './cv-bank.service';
import { CvBankController } from './cv-bank.controller';

@Module({
  imports: [CandidatesModule, EvaluationModule, JoiningModule],
  controllers: [CvBankController],
  providers: [CvBankService],
})
export class CvBankModule {}
