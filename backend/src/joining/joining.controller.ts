import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { assertJoiningAccess } from '../common/scope';
import { ApproveDto, JoinedQuery, JoiningUpdateDto, ReasonDto } from './joining.dto';
import { JoiningService } from './joining.service';

@Controller('joining')
export class JoiningController {
  constructor(private readonly svc: JoiningService, @InjectDataSource() private readonly ds: DataSource) {}

  @Get('pending')
  @RequirePerm(P.JOINING_VIEW)
  pending(@CurrentUser() me: AuthUser) {
    return this.svc.pending(me);
  }

  @Get('rejected')
  @RequirePerm(P.JOINING_VIEW)
  rejected(@CurrentUser() me: AuthUser) {
    return this.svc.rejected(me);
  }

  @Get('joined')
  @RequirePerm(P.JOINED_VIEW)
  joined(@Query() q: JoinedQuery, @CurrentUser() me: AuthUser) {
    return this.svc.joined(q, me);
  }

  @Put(':id')
  @RequirePerm(P.JOINING_APPROVE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JoiningUpdateDto, @CurrentUser() me: AuthUser) {
    await assertJoiningAccess(this.ds, me, id);
    return this.svc.update(id, dto, me);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePerm(P.JOINING_APPROVE)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto, @CurrentUser() me: AuthUser) {
    await assertJoiningAccess(this.ds, me, id);
    return this.svc.approve(id, dto, me);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePerm(P.JOINING_APPROVE)
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() me: AuthUser) {
    await assertJoiningAccess(this.ds, me, id);
    return this.svc.reject(id, dto.remarks, me);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePerm(P.JOINING_APPROVE)
  async reopen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() me: AuthUser) {
    await assertJoiningAccess(this.ds, me, id);
    return this.svc.reopen(id, dto.remarks, me);
  }
}
