import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from './config';
import { AuthGuard } from './common/auth';
import { CommonModule } from './common/common.module';
import { dataSourceOptions } from './database/data-source';
import { User } from './database/entities';
import { AuthModule } from './auth/auth.module';
import { RolesPermissionsModule } from './roles-permissions/roles-permissions.module';
import { CandidatesModule } from './candidates/candidates.module';
import { CvBankModule } from './cv-bank/cv-bank.module';
import { EmailModule } from './email/email.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { JoiningModule } from './joining/joining.module';
import { MasterModule } from './master/master.module';
import { ProcessingModule } from './processing/processing.module';
import { ReportsModule } from './reports/reports.module';
import { RequisitionsModule } from './requisitions/requisitions.module';
import { SystemModule } from './system/system.module';
import { VacanciesModule } from './vacancies/vacancies.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...dataSourceOptions }),
    TypeOrmModule.forFeature([User]),
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.jwtExpiresIn as any } }),
    CommonModule,
    ProcessingModule,
    AuthModule,
    RolesPermissionsModule,
    MasterModule,
    RequisitionsModule,
    VacanciesModule,
    CandidatesModule,
    CvBankModule,
    EvaluationModule,
    EmailModule,
    JoiningModule,
    ReportsModule,
    SystemModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
