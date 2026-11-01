import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { MonitorController } from './processing.controller';

@Global()
@Module({
  controllers: [MonitorController],
  providers: [JobsService],
  exports: [JobsService],
})
export class ProcessingModule {}
