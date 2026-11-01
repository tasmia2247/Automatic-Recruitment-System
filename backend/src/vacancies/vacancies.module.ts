import { Module } from '@nestjs/common';
import { VacancyService } from './vacancies.service';
import { VacanciesController } from './vacancies.controller';

@Module({
  controllers: [VacanciesController],
  providers: [VacancyService],
  exports: [VacancyService],
})
export class VacanciesModule {}
