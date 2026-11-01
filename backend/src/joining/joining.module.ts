import { Module } from '@nestjs/common';
import { JoiningService } from './joining.service';
import { JoiningController } from './joining.controller';

@Module({ controllers: [JoiningController], providers: [JoiningService], exports: [JoiningService] })
export class JoiningModule {}
