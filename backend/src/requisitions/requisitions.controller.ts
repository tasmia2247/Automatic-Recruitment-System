import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource, In } from 'typeorm';
import { config } from '../config';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { AuditService } from '../common/services';
import { ApprovalRoute, ApprovalRouteStep, User } from '../database/entities';
import {
  ApprovalRouteDto, AttachmentQuery, CorporateHrDto, DecisionDto, ReasonDto, RequisitionDto, RequisitionListQuery,
  StepReasonDto,
} from './requisitions.dto';
import { RequisitionService } from './requisitions.service';

@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly svc: RequisitionService) {}

  @Get()
  @RequirePerm(P.REQ_VIEW)
  list(@Query() q: RequisitionListQuery, @CurrentUser() me: AuthUser) {
    return this.svc.list(q, me);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.detail(id, me);
  }

  @Post()
  @RequirePerm(P.REQ_CREATE)
  create(@Body() dto: RequisitionDto, @CurrentUser() me: AuthUser) {
    return this.svc.create(dto, me);
  }

  @Put(':id')
  @RequirePerm(P.REQ_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RequisitionDto, @CurrentUser() me: AuthUser) {
    return this.svc.update(id, dto, me);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePerm(P.REQ_SUBMIT)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.svc.submit(id, me);
  }

  // Decisions accept JSON, or multipart with an optional supporting document in `file`.
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePerm(P.APPROVAL_ACT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() me: AuthUser) {
    return this.svc.approve(id, me, { remarks: dto.remarks, actionId: dto.actionId, file });
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePerm(P.APPROVAL_ACT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StepReasonDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() me: AuthUser) {
    return this.svc.reject(id, me, dto.reason, { actionId: dto.actionId, file });
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePerm(P.APPROVAL_ACT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  returnForClarification(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StepReasonDto, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() me: AuthUser) {
    return this.svc.returnForClarification(id, me, dto.reason, { actionId: dto.actionId, file });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() me: AuthUser) {
    return this.svc.cancel(id, me, dto.reason);
  }

  @Post(':id/corporate-hr')
  @HttpCode(200)
  corporateHr(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CorporateHrDto, @CurrentUser() me: AuthUser) {
    return this.svc.corporateHr(id, dto, me);
  }

  @Post(':id/attachments')
  @RequirePerm(P.REQ_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  attach(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Query() q: AttachmentQuery, @CurrentUser() me: AuthUser) {
    return this.svc.addAttachment(id, file, q.kind ?? 'OTHER', me);
  }

  @Get(':id/attachments/:attId')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @CurrentUser() me: AuthUser, @Res() res: Response) {
    const { att, buffer } = await this.svc.getAttachment(id, attId, me);
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.originalName)}"`);
    res.send(buffer);
  }
}

@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly svc: RequisitionService,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Get('inbox')
  @RequirePerm(P.APPROVAL_ACT)
  inbox(@CurrentUser() me: AuthUser) {
    return this.svc.inbox(me);
  }

  @Get('routes')
  @RequirePerm(P.APPROVAL_ROUTE_CONFIGURE)
  routes() {
    return this.ds.getRepository(ApprovalRoute).find({ relations: { steps: { approver: true } }, order: { name: 'ASC', steps: { stepOrder: 'ASC' } } });
  }

  @Post('routes')
  @RequirePerm(P.APPROVAL_ROUTE_CONFIGURE)
  createRoute(@Body() dto: ApprovalRouteDto, @CurrentUser() me: AuthUser) {
    return this.saveRoute(null, dto, me);
  }

  @Put('routes/:id')
  @RequirePerm(P.APPROVAL_ROUTE_CONFIGURE)
  updateRoute(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalRouteDto, @CurrentUser() me: AuthUser) {
    return this.saveRoute(id, dto, me);
  }

  /** Route edits apply to future submissions; in-flight approvals keep their assigned approvers. */
  private async saveRoute(id: string | null, dto: ApprovalRouteDto, me: AuthUser) {
    const orders = dto.steps.map((s) => s.stepOrder);
    if (new Set(orders).size !== orders.length) throw new BadRequestException('Step order numbers must be unique.');
    return this.ds.transaction(async (m) => {
      const users = await m.find(User, { where: { id: In(dto.steps.map((s) => s.approverUserId)) } });
      if (users.some((u) => !u.active) || new Set(users.map((u) => u.id)).size !== new Set(dto.steps.map((s) => s.approverUserId)).size) {
        throw new BadRequestException('Every step needs an active named approver account.');
      }
      let route: ApprovalRoute | null = null;
      let old: unknown = null;
      if (id) {
        route = await m.findOne(ApprovalRoute, { where: { id }, relations: { steps: true } });
        if (!route) throw new NotFoundException('Route not found.');
        old = { name: route.name, departmentId: route.departmentId, active: route.active, steps: route.steps.map((s) => ({ stepOrder: s.stepOrder, label: s.label, approverUserId: s.approverUserId, required: s.required })) };
        await m.delete(ApprovalRouteStep, { routeId: id });
      }
      if (dto.active !== false) {
        const clash = await m.createQueryBuilder(ApprovalRoute, 'r').where('r.active = true')
          .andWhere(dto.departmentId ? 'r.departmentId = :d' : 'r.departmentId IS NULL', { d: dto.departmentId })
          .andWhere(id ? 'r.id <> :id' : '1=1', { id }).getExists();
        if (clash) throw new BadRequestException('Another active route already applies to this department (or as the default).');
      }
      route = m.create(ApprovalRoute, { ...(route ?? {}), name: dto.name, departmentId: dto.departmentId ?? null, active: dto.active ?? true });
      route.steps = dto.steps.map((s) => m.create(ApprovalRouteStep, { ...s, required: s.required ?? true }));
      const saved = await m.save(route);
      await this.audit.log(m, me, id ? 'approval_route.update' : 'approval_route.create', 'ApprovalRoute', saved.id, { label: saved.name, old: old as any, new: { ...dto } as any });
      return saved;
    });
  }
}
