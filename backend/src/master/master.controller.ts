import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
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

const count = (table: string, column: string) => `SELECT count(*)::int AS n FROM ${table} WHERE "${column}" = $1`;
/** Everything that refers to a master record; any of these blocks a delete. Access scopes keep department IDs inside JSON. */
const IN_USE: Record<'companies' | 'departments' | 'positions', [string, string][]> = {
  companies: [['requisition(s)', count('requisitions', 'companyId')], ['vacancy(ies)', count('vacancies', 'companyId')], ['quota row(s)', count('manpower_quotas', 'companyId')]],
  departments: [
    ['requisition(s)', count('requisitions', 'departmentId')], ['vacancy(ies)', count('vacancies', 'departmentId')], ['quota row(s)', count('manpower_quotas', 'departmentId')],
    ['user(s)', `SELECT count(*)::int AS n FROM users WHERE "departmentId" = $1 OR "departmentScopes"::text LIKE '%' || $1::text || '%'`],
    ['approval route(s)', count('approval_routes', 'departmentId')],
    ['permission template(s)', `SELECT count(*)::int AS n FROM permission_templates WHERE "departmentScopes"::text LIKE '%' || $1::text || '%'`],
  ],
  positions: [['requisition(s)', count('requisitions', 'positionId')], ['vacancy(ies)', count('vacancies', 'positionId')], ['quota row(s)', count('manpower_quotas', 'positionId')]],
};

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

  @Delete('companies/:id')
  @RequirePerm(P.MASTER_CONFIGURE)
  deleteCompany(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.deleteMaster('companies', id, me);
  }

  @Delete('departments/:id')
  @RequirePerm(P.MASTER_CONFIGURE)
  deleteDepartment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.deleteMaster('departments', id, me);
  }

  @Delete('positions/:id')
  @RequirePerm(P.MASTER_CONFIGURE)
  deletePosition(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.deleteMaster('positions', id, me);
  }

  /**
   * Deletes a company, department or position only while nothing uses it (owner, 2026-11-04); otherwise 409 names what
   * uses it, so history is never broken. Deactivating stays the way to retire a record that is in use.
   */
  private async deleteMaster(kind: keyof typeof IN_USE, id: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const Entity = { ...MASTER, positions: Position }[kind];
      const rec: any = await m.findOne(Entity as any, { where: { id } });
      if (!rec) throw new NotFoundException();
      const uses: string[] = [];
      for (const [label, sql] of IN_USE[kind]) {
        const [{ n }] = await m.query(sql, [id]);
        if (n) uses.push(`${n} ${label}`);
      }
      if (uses.length) throw new ConflictException(`In use by ${uses.join(', ')}. Deactivate it instead, or remove those uses first.`);
      await m.delete(Entity as any, id);
      await this.audit.log(m, me, `${kind}.delete`, (Entity as any).name, id, { label: rec.code ?? rec.title, old: { code: rec.code, name: rec.name ?? rec.title } });
      return { deleted: true };
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
    // Dept-total rows grouped at the top, then designation rows under them (owner, 2026-11-09): department totals are
    // the reference figure, and admins want to edit them together without scrolling through every designation row.
    const rows = await this.ds.getRepository(ManpowerQuota).find({
      where, relations: { company: true, department: true, position: true },
    });
    rows.sort((a, b) =>
      Number(!!a.positionId) - Number(!!b.positionId)
      || a.department.name.localeCompare(b.department.name)
      || a.company.code.localeCompare(b.company.code)
      || (a.position?.title ?? '').localeCompare(b.position?.title ?? ''));
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

  /**
   * Deletes a quota row (owner, 2026-11-08): `quota.edit` within the user's quota scope, so a department user only in their own
   * department and Super Admin anywhere. Nothing refers to a quota row by key (a quota-chart update finds or recreates the row),
   * so no history is lost; the figures are kept in the audit entry.
   */
  @Delete('quotas/:id')
  @RequirePerm(P.QUOTA_EDIT)
  async deleteQuota(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const rec = await m.findOne(ManpowerQuota, { where: { id }, relations: { department: true, position: true } });
      if (!rec) throw new NotFoundException();
      assertDepartmentAccess(me, rec.departmentId, 'quotas');
      await m.delete(ManpowerQuota, id);
      await this.audit.log(m, me, 'quota.delete', 'ManpowerQuota', id, {
        label: `${rec.department.name} — ${rec.position?.title ?? 'Department total'}`,
        old: { companyId: rec.companyId, departmentId: rec.departmentId, positionId: rec.positionId, approvedQuota: rec.approvedQuota, presentManpower: rec.presentManpower, remarks: rec.remarks },
      });
      return { deleted: true };
    });
  }
}
