import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { config } from '../config';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { CircularFileQuery, CoordinatorDto, CriteriaSetDto, DirectVacancyDto, HrQueueQuery, JobPostDto, JobPostStatusDto, VacancyListQuery, VacancyUpdateDto } from './vacancies.dto';
import { VacancyService } from './vacancies.service';

@Controller()
export class VacanciesController {
  constructor(private readonly svc: VacancyService) {}

  @Get('hr-queue')
  @RequirePerm(P.HR_QUEUE)
  hrQueue(@Query() q: HrQueueQuery) {
    return this.svc.hrQueue(q);
  }

  @Get('hr-queue/coordinators')
  @RequirePerm(P.COORDINATOR_ASSIGN)
  coordinators() {
    return this.svc.coordinators();
  }

  @Put('hr-queue/:requisitionId/coordinator')
  @RequirePerm(P.HR_QUEUE, P.COORDINATOR_ASSIGN)
  assignFromQueue(@Param('requisitionId', ParseUUIDPipe) id: string, @Body() dto: CoordinatorDto, @CurrentUser() me: AuthUser) {
    return this.svc.assignCoordinator({ requisitionId: id }, dto.coordinatorId ?? null, me);
  }

  @Put('vacancies/:id/coordinator')
  @RequirePerm(P.COORDINATOR_ASSIGN)
  assignToVacancy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CoordinatorDto, @CurrentUser() me: AuthUser) {
    return this.svc.assignCoordinator({ vacancyId: id }, dto.coordinatorId ?? null, me);
  }

  @Post('hr-queue/:requisitionId/vacancy')
  @HttpCode(200)
  @RequirePerm(P.VACANCY_CREATE)
  createFromRequisition(@Param('requisitionId', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.createFromRequisition(id, me);
  }

  @Get('vacancies')
  @RequirePerm(P.VACANCY_VIEW)
  list(@Query() q: VacancyListQuery, @CurrentUser() me: AuthUser) {
    return this.svc.list(q, me);
  }

  @Post('vacancies/direct')
  @RequirePerm(P.VACANCY_DIRECT)
  createDirect(@Body() dto: DirectVacancyDto, @CurrentUser() me: AuthUser) {
    return this.svc.createDirect(dto, me);
  }

  @Get('vacancies/:id')
  @RequirePerm(P.VACANCY_VIEW)
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.detail(id, me);
  }

  @Put('vacancies/:id')
  @RequirePerm(P.VACANCY_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VacancyUpdateDto, @CurrentUser() me: AuthUser) {
    return this.svc.update(id, dto, me);
  }

  @Post('vacancies/:id/job-posts')
  @RequirePerm(P.JOBPOST_EDIT)
  createJobPost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JobPostDto, @CurrentUser() me: AuthUser) {
    return this.svc.createJobPost(id, dto, me);
  }

  @Get('job-posts/:id')
  @RequirePerm(P.VACANCY_VIEW)
  getJobPost(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.getJobPost(id, me);
  }

  @Put('job-posts/:id')
  @RequirePerm(P.JOBPOST_EDIT)
  updateJobPost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JobPostDto, @CurrentUser() me: AuthUser) {
    return this.svc.updateJobPost(id, dto, me);
  }

  @Post('job-posts/:id/status')
  @HttpCode(200)
  @RequirePerm(P.JOBPOST_EDIT)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JobPostStatusDto, @CurrentUser() me: AuthUser) {
    return this.svc.setJobPostStatus(id, dto.status, me);
  }

  @Post('job-posts/:id/criteria')
  @RequirePerm(P.JOBPOST_EDIT)
  saveCriteria(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CriteriaSetDto, @CurrentUser() me: AuthUser) {
    return this.svc.saveCriteria(id, dto, me);
  }

  @Post('job-posts/:id/circular')
  @RequirePerm(P.JOBPOST_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  attachCircular(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() me: AuthUser) {
    return this.svc.attachCircular(id, file, me);
  }

  @Get('job-posts/:id/circular')
  @RequirePerm(P.VACANCY_VIEW)
  async circular(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Res() res: Response) {
    const { name, buffer } = await this.svc.circular(id, me);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.send(buffer);
  }

  /** Generated circular: ?format=pdf (poster) or txt (plain text); ?download=1 saves instead of opening. */
  @Get('job-posts/:id/circular-file')
  @RequirePerm(P.VACANCY_VIEW)
  async generatedCircular(@Param('id', ParseUUIDPipe) id: string, @Query() q: CircularFileQuery, @CurrentUser() me: AuthUser, @Res() res: Response) {
    const { name, type, buffer } = await this.svc.generatedCircular(id, q.format ?? 'pdf', me);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `${q.download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }
}
