import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { ReportsQuery } from './reports.dto';
import { ReportsService } from './reports.service';

/**
 * Reports & Analytics (owner, 2026-11-09): read-only aggregated views over recruitment.
 * Every endpoint requires `report.view` and is clamped to the user's coordinator scope.
 */
@Controller('reports')
@RequirePerm(P.REPORTS_VIEW)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('overview') overview(@Query() q: ReportsQuery, @CurrentUser() me: AuthUser) { return this.svc.overview(q, me); }
  @Get('vacancies') vacancies(@Query() q: ReportsQuery, @CurrentUser() me: AuthUser) { return this.svc.vacancyReport(q, me); }
  @Get('trends') trends(@Query() q: ReportsQuery, @CurrentUser() me: AuthUser) { return this.svc.trends(q, me); }
  @Get('sources') sources(@Query() q: ReportsQuery, @CurrentUser() me: AuthUser) { return this.svc.sources(q, me); }
  @Get('approval-tat') approvalTat(@Query() q: ReportsQuery, @CurrentUser() me: AuthUser) { return this.svc.approvalTat(q, me); }
  @Get('screening-quality') screening(@Query() q: ReportsQuery, @CurrentUser() me: AuthUser) { return this.svc.screeningQuality(q, me); }
}
