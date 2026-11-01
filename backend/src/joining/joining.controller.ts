import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { assertJoiningAccess } from '../common/scope';
import { ApproveDto, JoinedQuery, JoiningUpdateDto, NotJoinedDto } from './joining.dto';
import { JoiningService } from './joining.service';

@Controller('joining')
export class JoiningController {
  constructor(private readonly svc: JoiningService, @InjectDataSource() private readonly ds: DataSource) {}

  @Get('pending')
  @RequirePerm(P.JOINING_VIEW)
  pending(@CurrentUser() me: AuthUser) {
    return this.svc.pending(me);
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

  @Post(':id/not-joined')
  @HttpCode(200)
  @RequirePerm(P.JOINING_APPROVE)
  async notJoined(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NotJoinedDto, @CurrentUser() me: AuthUser) {
    await assertJoiningAccess(this.ds, me, id);
    return this.svc.notJoined(id, dto.remarks, me);
  }
}
