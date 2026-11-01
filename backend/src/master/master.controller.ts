import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import { AuthUser, CurrentUser, RequirePerm } from '../common/auth';
import { P } from '../common/permissions';
import { assertDepartmentAccess, computeVacancy, departmentScope } from '../common/scope';
import { AuditService, diff } from '../common/services';
import { Company, Department, ManpowerQuota, Position } from '../database/entities';
import { MasterDto, MasterUpdateDto, PositionDto, QuotaDto, QuotaQuery, QuotaUpdateDto } from './master.dto';

export const MASTER = { companies: Company, departments: Department } as const;

@Controller('master')
export class MasterController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly audit: AuditService) {}

  @Get('lookups')
  async lookups() {
    const [companies, departments, positions] = await Promise.all([
      this.ds.getRepository(Company).find({ order: { name: 'ASC' } }),
      this.ds.getRepository(Department).find({ order: { name: 'ASC' } }),
      this.ds.getRepository(Position).find({ order: { title: 'ASC' } }),
    ]);
    return { companies, departments, positions };
  }

  @Post('companies')
  @RequirePerm(P.MASTER_CONFIGURE)
  createCompany(@Body() dto: MasterDto, @CurrentUser() me: AuthUser) {
    return this.createMaster('companies', dto, me);
  }

  @Post('departments')
  @RequirePerm(P.MASTER_CONFIGURE)
  createDepartment(@Body() dto: MasterDto, @CurrentUser() me: AuthUser) {
    return this.createMaster('departments', dto, me);
  }

  @Patch('companies/:id')
  @RequirePerm(P.MASTER_CONFIGURE)
  updateCompany(@Param('id') id: string, @Body() dto: MasterUpdateDto, @CurrentUser() me: AuthUser) {
    return this.updateMaster('companies', id, dto, me);
  }

  @Patch('departments/:id')
  @RequirePerm(P.MASTER_CONFIGURE)
  updateDepartment(@Param('id') id: string, @Body() dto: MasterUpdateDto, @CurrentUser() me: AuthUser) {
    return this.updateMaster('departments', id, dto, me);
  }

  private async createMaster(kind: keyof typeof MASTER, dto: MasterDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const Entity = MASTER[kind];
      if (await m.exists(Entity, { where: { code: dto.code } })) throw new BadRequestException('Code already exists.');
      const rec = await m.save(Entity, m.create(Entity, dto));
      await this.audit.log(m, me, `${kind}.create`, Entity.name, rec.id, { label: rec.code, new: { ...dto } });
      return rec;
    });
  }

  private async updateMaster(kind: keyof typeof MASTER, id: string, dto: MasterUpdateDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const Entity = MASTER[kind];
      const rec = await m.findOne(Entity, { where: { id } });
      if (!rec) throw new NotFoundException();
      const d = diff(rec, { ...rec, ...dto }, ['code', 'name', 'active']);
      Object.assign(rec, dto);
      await m.save(rec);
      await this.audit.log(m, me, `${kind}.update`, Entity.name, rec.id, { label: rec.code, ...d });
      return rec;
    });
  }

  @Post('positions')
  @RequirePerm(P.MASTER_CONFIGURE)
  async createPosition(@Body() dto: PositionDto, @CurrentUser() me: AuthUser) {
    return this.ds.transaction(async (m) => {
      if (await m.exists(Position, { where: { title: dto.title } })) throw new BadRequestException('Position already exists.');
      const rec = await m.save(Position, m.create(Position, dto));
      await this.audit.log(m, me, 'positions.create', 'Position', rec.id, { label: rec.title, new: { ...dto } });
      return rec;
    });
  }

  @Patch('positions/:id')
  @RequirePerm(P.MASTER_CONFIGURE)
  async updatePosition(@Param('id') id: string, @Body() dto: PositionDto, @CurrentUser() me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const rec = await m.findOne(Position, { where: { id } });
      if (!rec) throw new NotFoundException();
      const d = diff(rec, { ...rec, ...dto }, ['title', 'code', 'active']);
      Object.assign(rec, dto);
      await m.save(rec);
      await this.audit.log(m, me, 'positions.update', 'Position', rec.id, { label: rec.title, ...d });
      return rec;
    });
  }

  /** Department position/quota list with separate department & designation vacancy figures (SRS 5.1). */
  @Get('quotas')
  @RequirePerm(P.QUOTA_VIEW)
  async quotas(@Query() q: QuotaQuery, @CurrentUser() me: AuthUser) {
    const scope = departmentScope(me, 'quotas');
    const where: Record<string, unknown> = {};
    // A department filter narrows the scope but can never widen it.
    if (scope) where.departmentId = In(q.departmentId && scope.includes(q.departmentId) ? [q.departmentId] : scope);
    else if (q.departmentId) where.departmentId = q.departmentId;
    if (q.companyId) where.companyId = q.companyId;
    const rows = await this.ds.getRepository(ManpowerQuota).find({
      where, relations: { company: true, department: true, position: true },
      order: { department: { name: 'ASC' } },
    });
    return rows.map((r) => {
      const v = computeVacancy(r.approvedQuota, r.presentManpower);
      return { ...r, level: r.positionId ? 'Designation' : 'Department', vacancy: v.value, vacancyFlag: v.flag };
    });
  }

  @Post('quotas')
  @RequirePerm(P.QUOTA_EDIT)
  async createQuota(@Body() dto: QuotaDto, @CurrentUser() me: AuthUser) {
    assertDepartmentAccess(me, dto.departmentId, 'quotas');
    return this.ds.transaction(async (m) => {
      const exists = await m.exists(ManpowerQuota, {
        where: { companyId: dto.companyId, departmentId: dto.departmentId, positionId: dto.positionId ?? IsNull() },
      });
      if (exists) throw new BadRequestException('A quota row already exists for this company/department/position.');
      const rec = await m.save(ManpowerQuota, m.create(ManpowerQuota, { ...dto, positionId: dto.positionId ?? null, updatedById: me.id }));
      await this.audit.log(m, me, 'quota.create', 'ManpowerQuota', rec.id, { new: { ...dto } });
      return rec;
    });
  }

  @Patch('quotas/:id')
  @RequirePerm(P.QUOTA_EDIT)
  async updateQuota(@Param('id') id: string, @Body() dto: QuotaUpdateDto, @CurrentUser() me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const rec = await m.findOne(ManpowerQuota, { where: { id } });
      if (!rec) throw new NotFoundException();
      assertDepartmentAccess(me, rec.departmentId, 'quotas');
      if (dto.approvedQuota !== undefined && dto.approvedQuota !== rec.approvedQuota && !me.permissions.has(P.REQ_QUOTA_CHART)) {
        throw new BadRequestException('Approved quota can only change through an approved requisition / quota-chart update.');
      }
      const d = diff(rec, { ...rec, ...dto }, ['approvedQuota', 'presentManpower', 'remarks']);
      Object.assign(rec, dto, { updatedById: me.id });
      await m.save(rec);
      await this.audit.log(m, me, 'quota.update', 'ManpowerQuota', rec.id, d);
      return rec;
    });
  }
}
