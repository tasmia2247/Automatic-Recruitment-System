import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { assertJoiningAccess } from '../common/scope';
import { ApproveBatchDto, ApproveDto, JoinedQuery, JoiningUpdateDto, ReasonDto } from './joining.dto';
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

  /**
   * Approves several pending joinings with one actual joining date (owner, 2026-11-08: pick a date, select all, join).
   * Each candidate goes through the same checks as a single approval in its own transaction, so one that fails (another
   * coordinator's vacancy, all seats filled, no longer Selected) does not stop the rest; the result lists each one.
   */
  @Post('approve-batch')
  @HttpCode(200)
  @RequirePerm(P.JOINING_APPROVE)
  async approveBatch(@Body() dto: ApproveBatchDto, @CurrentUser() me: AuthUser) {
    const results: { id: string; ok: boolean; error?: string; duplicate?: boolean }[] = [];
    for (const id of [...new Set(dto.ids)]) {
      try {
        await assertJoiningAccess(this.ds, me, id);
        const r = await this.svc.approve(id, { joiningDate: dto.joiningDate, remarks: dto.remarks }, me);
        results.push({ id, ok: true, duplicate: r.duplicate });
      } catch (e: any) {
        results.push({ id, ok: false, error: e?.response?.message ?? e?.message ?? 'Failed.' });
      }
    }
    return { approved: results.filter((r) => r.ok && !r.duplicate).length, failed: results.filter((r) => !r.ok).length, results };
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
