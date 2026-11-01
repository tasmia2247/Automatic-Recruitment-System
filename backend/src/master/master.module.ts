import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company, Department, ManpowerQuota, Position } from '../database/entities';
import { MasterController } from './master.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Department, Position, ManpowerQuota])],
  controllers: [MasterController],
})
export class MasterModule {}
