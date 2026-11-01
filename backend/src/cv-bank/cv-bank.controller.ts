import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { CvBankQuery, StatusChangeDto } from './cv-bank.dto';
import { CvBankService } from './cv-bank.service';

@Controller()
export class CvBankController {
  constructor(private readonly svc: CvBankService) {}

  @Get('cv-bank/tree')
  @RequirePerm(P.CANDIDATE_VIEW)
  tree(@Query() q: CvBankQuery, @CurrentUser() me: AuthUser) {
    return this.svc.tree(q, me);
  }

  @Get('cv-bank/applications')
  @RequirePerm(P.CANDIDATE_VIEW)
  applications(@Query() q: CvBankQuery, @CurrentUser() me: AuthUser) {
    return this.svc.applications(q, me);
  }

  @Post('applications/:id/status')
  @HttpCode(200)
  @RequirePerm(P.CANDIDATE_VIEW)
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto, @CurrentUser() me: AuthUser) {
    return this.svc.changeStatus(id, dto, me);
  }
}
