import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { config } from '../config';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { assertApplicationAccess, assertApplicationsAccess, assertDocumentAccess, assertVacancyAccess } from '../common/scope';
import { CandidatesService } from './candidates.service';
import { ApplicationListQuery, AssignDto, CorrectionDto, DocumentQuery, DuplicateDto, ExportQuery, RemarkDto, ShortlistDto } from './candidates.dto';
import { MAX_MAIL_BYTES, MAX_MAILS_PER_UPLOAD, MailIntakeService } from './mail-intake.service';

@Controller()
export class CandidatesController {
  constructor(private readonly svc: CandidatesService, private readonly mail: MailIntakeService, @InjectDataSource() private readonly ds: DataSource) {}

  @Post('vacancies/:id/cvs')
  @RequirePerm(P.CV_UPLOAD)
  @UseInterceptors(FilesInterceptor('files', 50, { limits: { fileSize: config.maxUploadBytes } }))
  async upload(@Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[], @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.uploadManual(id, files, me);
  }

  @Get('vacancies/:id/applications')
  @RequirePerm(P.CANDIDATE_VIEW)
  async list(@Param('id', ParseUUIDPipe) id: string, @Query() q: ApplicationListQuery, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.listForVacancy(id, q);
  }

  @Post('vacancies/:id/rescreen')
  @HttpCode(200)
  @RequirePerm(P.SCREENING_RUN)
  async rescreen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.rescreenVacancy(id, me);
  }

  /** Reads every stored CV of the vacancy again with the current extractor, then screens it again. */
  @Post('vacancies/:id/reread')
  @HttpCode(200)
  @RequirePerm(P.SCREENING_RUN)
  async reread(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.rereadCvs({ vacancyId: id }, me);
  }

  @Post('applications/:id/reread')
  @HttpCode(200)
  @RequirePerm(P.SCREENING_RUN)
  async rereadOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.rereadCvs({ applicationId: id }, me);
  }

  @Post('vacancies/:id/shortlist')
  @HttpCode(200)
  @RequirePerm(P.SHORTLIST)
  async shortlist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShortlistDto, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    await assertApplicationsAccess(this.ds, me, dto.applicationIds);
    return this.svc.shortlist(id, dto.applicationIds, dto.shortlisted, dto.reason, me);
  }

  @Get('vacancies/:id/export')
  @RequirePerm(P.EXPORT)
  async export(@Param('id', ParseUUIDPipe) id: string, @Query() q: ExportQuery, @CurrentUser() me: AuthUser, @Res() res: Response) {
    await assertVacancyAccess(this.ds, me, id);
    const { fileName, buffer } = await this.svc.exportVacancy(id, q.result, me);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  /** The CV data sheet as rows, for viewing it in the browser. */
  @Get('vacancies/:id/cv-data')
  @RequirePerm(P.CANDIDATE_VIEW)
  async cvData(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertVacancyAccess(this.ds, me, id);
    return this.svc.cvData(id);
  }

  @Get('vacancies/:id/cv-data-export')
  @RequirePerm(P.EXPORT)
  async cvDataExport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser, @Res() res: Response) {
    await assertVacancyAccess(this.ds, me, id);
    const { fileName, buffer } = await this.svc.exportCvData(id, me);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Get('applications/:id')
  @RequirePerm(P.CANDIDATE_VIEW)
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.detail(id);
  }

  @Patch('applications/:id')
  @RequirePerm(P.CANDIDATE_EDIT)
  async correct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectionDto, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.correct(id, dto, me);
  }

  @Post('applications/:id/remarks')
  @RequirePerm(P.CANDIDATE_VIEW)
  async remark(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemarkDto, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.addRemark(id, dto.text, me);
  }

  @Post('applications/:id/duplicate')
  @HttpCode(200)
  @RequirePerm(P.CANDIDATE_MERGE)
  async duplicate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicateDto, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.resolveDuplicate(id, dto.action, me);
  }

  @Get('applications/:id/jobs')
  @RequirePerm(P.CANDIDATE_VIEW)
  async jobs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    await assertApplicationAccess(this.ds, me, id);
    return this.svc.pendingJobsFor(id);
  }

  @Get('documents/:id')
  @RequirePerm(P.CV_DOWNLOAD)
  async document(@Param('id', ParseUUIDPipe) id: string, @Query() q: DocumentQuery, @CurrentUser() me: AuthUser, @Res() res: Response) {
    await assertDocumentAccess(this.ds, me, id);
    const { doc, buffer } = await this.svc.document(id);
    // Some clients upload as octet-stream; serve known CV types by extension so the preview renders inline.
    const byExt: Record<string, string> = { '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
    const ext = doc.originalName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
    res.setHeader('Content-Type', doc.mimeType === 'application/octet-stream' && byExt[ext] ? byExt[ext] : doc.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${q.download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(doc.originalName)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  @Get('intake/mail-folder')
  @RequirePerm(P.CV_UPLOAD, P.RECRUITMENT_ALL)
  mailFolder() {
    return this.mail.folder();
  }

  @Post('intake/scan')
  @HttpCode(200)
  @RequirePerm(P.CV_UPLOAD, P.RECRUITMENT_ALL)
  scan(@CurrentUser() me: AuthUser) {
    return this.mail.scanFolder(me);
  }

  @Post('intake/scan-files')
  @HttpCode(200)
  @RequirePerm(P.CV_UPLOAD, P.RECRUITMENT_ALL)
  @UseInterceptors(FilesInterceptor('files', MAX_MAILS_PER_UPLOAD, { limits: { fileSize: MAX_MAIL_BYTES } }))
  scanFiles(@UploadedFiles() files: Express.Multer.File[], @CurrentUser() me: AuthUser) {
    return this.mail.scanFiles(files, me);
  }

  @Get('intake/unmatched')
  @RequirePerm(P.CV_UPLOAD, P.RECRUITMENT_ALL)
  unmatched() {
    return this.svc.unmatched();
  }

  @Post('intake/:id/assign')
  @HttpCode(200)
  @RequirePerm(P.CV_UPLOAD, P.RECRUITMENT_ALL)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @CurrentUser() me: AuthUser) {
    return this.svc.assignUnmatched(id, dto.vacancyId, me);
  }

  @Delete('intake/:id')
  @RequirePerm(P.CV_UPLOAD, P.RECRUITMENT_ALL)
  deleteUnmatched(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.deleteUnmatched(id, me);
  }
}
