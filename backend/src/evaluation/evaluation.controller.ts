import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { config } from '../config';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { assertApplicationAccess, assertApplicationsAccess, assertImportAccess, assertVacancyAccess } from '../common/scope';
import { STAGE_TYPES, StageType } from '../database/entities';
import { EvaluationService } from './evaluation.service';
import { ConfirmDto, DecisionDto, ImportQuery, InterviewBoardQuery, MainImportQuery, MarkDto, ScheduleDto, StageDto, TemplateQuery } from './evaluation.dto';

@Controller()
export class EvaluationController {
  constructor(private readonly svc: EvaluationService, @InjectDataSource() private readonly ds: DataSource) {}

  @Get('vacancies/:id/evaluation')
  @RequirePerm(P.CANDIDATE_VIEW)
  async board(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.board(id);
  }

  @Post('vacancies/:id/schedule')
  @HttpCode(200)
  @RequirePerm(P.SHORTLIST)
  async schedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    await assertApplicationsAccess(this.ds, me, dto.applicationIds);
    return this.svc.schedule(id, dto.applicationIds, dto.stageType, dto.scheduledAt, dto, me);
  }

  /** Interview Board: shortlisted candidates of every vacancy the user may see, with their rounds. */
  @Get('interviews/board')
  @RequirePerm(P.CANDIDATE_VIEW)
  interviewBoard(@Query() q: InterviewBoardQuery, @CurrentUser() me: AuthUser) {
    return this.svc.interviewBoard(q, me);
  }

  @Post('interviews/schedule')
  @HttpCode(200)
  @RequirePerm(P.SHORTLIST)
  async scheduleAny(@Body() dto: ScheduleDto, @CurrentUser() me: AuthUser) {
    await assertApplicationsAccess(this.ds, me, dto.applicationIds);
    return this.svc.schedule(null, dto.applicationIds, dto.stageType, dto.scheduledAt, dto, me);
  }

  @Put('applications/:id/stages/:stage')
  async stage(@Param('id', ParseUUIDPipe) id: string, @Param('stage') stage: string, @Body() dto: StageDto, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.upsertStage(id, this.stageType(stage), dto, me);
  }

  @Put('applications/:id/marks')
  @RequirePerm(P.MARKS_ENTER)
  async mark(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkDto, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.saveMark(id, dto, me);
  }

  @Post('applications/:id/final-decision')
  @HttpCode(200)
  @RequirePerm(P.FINAL_DECISION)
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.finalDecision(id, dto.decision, dto.remarks, me);
  }

  @Get('vacancies/:id/marks-template')
  @RequirePerm(P.MARKS_IMPORT)
  async template(@Param('id', ParseUUIDPipe) id: string, @Query() q: TemplateQuery, @CurrentUser() me: AuthUser, @Res() res: Response) {
    await assertVacancyAccess(this.ds, me, id);
    const { fileName, buffer } = await this.svc.template(id, q.stageType);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('vacancies/:id/marks-import')
  @RequirePerm(P.MARKS_IMPORT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  async preview(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Query() q: ImportQuery, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.preview(id, file, q.stageType, q.component?.trim() || 'Total', q.maxMarks ?? null, me);
  }

  /** Written exam and interview board marks from one sheet: one preview batch per exam, each confirmed like any other. */
  @Post('vacancies/:id/marks-import-main')
  @RequirePerm(P.MARKS_IMPORT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  async previewMain(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Query() q: MainImportQuery, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.previewMain(id, file, { WRITTEN: q.writtenMaxMarks ?? null, INTERVIEW: q.interviewMaxMarks ?? null }, me);
  }

  @Get('imports/:id')
  @RequirePerm(P.MARKS_IMPORT)
  async batch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertImportAccess(this.ds, me, id);
    return this.svc.getBatch(id);
  }

  @Post('imports/:id/confirm')
  @HttpCode(200)
  @RequirePerm(P.MARKS_IMPORT)
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDto, @CurrentUser() me: AuthUser) {
    await assertImportAccess(this.ds, me, id);
    return this.svc.confirm(id, !!dto.allowOverwrite, me);
  }

  @Post('imports/:id/cancel')
  @HttpCode(200)
  @RequirePerm(P.MARKS_IMPORT)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertImportAccess(this.ds, me, id);
    return this.svc.cancel(id, me);
  }

  private stageType(s: string): StageType {
    const t = s.toUpperCase() as StageType;
    if (!STAGE_TYPES.includes(t)) throw new BadRequestException('Unknown stage.');
    return t;
  }
}
