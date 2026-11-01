import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { AuthUser, invalidatePermissionSettings } from '../common/auth';
import { ACTION_LABELS, MATRIX_ACTIONS, PERMISSION_MATRIX, SCOPE_MODULES } from '../common/permission-matrix';
import { ALL_PERMISSIONS, DEFAULT_ROLES, P } from '../common/permissions';
import { ALL_BY_DEFAULT } from '../common/scope';
import { AuditService, diff } from '../common/services';
import { Department, DepartmentScopes, PermissionSetting, PermissionTemplate, Role, User } from '../database/entities';
import { publicUser } from '../auth/auth.controller';
import {
  CreateRoleDto, CreateUserDto, DepartmentScopesDto, PermissionSettingDto, TemplateDto, UpdateRoleDto, UpdateUserDto,
} from './roles-permissions.dto';

/** Built-in roles: the seed recreates them, so they can be deactivated but not deleted. */
const BUILT_IN_ROLES = new Set(DEFAULT_ROLES.map((r) => r.code));
const emailTaken = (m: EntityManager, email: string, exceptId?: string) =>
  m.exists(User, { where: { email, deletedAt: IsNull(), ...(exceptId ? { id: Not(exceptId) } : {}) } });

@Injectable()
export class RolesPermissionsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly audit: AuditService) {}

  /** Module x action grid of every permission code, for the Users & Roles screen. */
  async matrix() {
    const settings = await this.ds.getRepository(PermissionSetting).find();
    const mod = new Map(settings.filter((s) => s.kind === 'module').map((s) => [s.key, s]));
    return {
      actions: MATRIX_ACTIONS.map((key) => ({ key, label: ACTION_LABELS[key] })),
      // Module (group) names can be renamed; defaultLabel keeps the built-in name for "reset".
      modules: PERMISSION_MATRIX.map((m) => ({
        ...m, defaultLabel: m.label, label: mod.get(m.key)?.label || m.label, description: mod.get(m.key)?.description ?? null,
      })),
      /** Per-code label / description overrides and the system-wide off switch. */
      permissions: Object.fromEntries(settings.filter((s) => s.kind === 'permission')
        .map((s) => [s.key, { label: s.label, description: s.description, disabled: s.disabled }])),
      scopeModules: SCOPE_MODULES,
      /** Without a user Access Scope, holding this permission means All departments, otherwise Own department. */
      scopeDefaults: ALL_BY_DEFAULT,
    };
  }

  // ------------------------------------------------------------------ users

  /** Accounts in use, or (deleted = true) deleted accounts that can be restored. */
  async users(deleted = false) {
    const list = await this.ds.getRepository(User).find({
      where: { deletedAt: deleted ? Not(IsNull()) : IsNull() }, relations: { roles: true, department: true }, order: { name: 'ASC' },
    });
    return list.map((u) => ({ ...publicUser(u), deletedAt: u.deletedAt }));
  }

  async createUser(dto: CreateUserDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const email = dto.email.toLowerCase();
      if (await emailTaken(m, email)) throw new BadRequestException({ message: 'Email already in use.', fieldErrors: { email: 'Email already in use.' } });
      const roles = await this.roles(m, dto.roleCodes);
      const user = m.create(User, {
        name: dto.name, email, designation: dto.designation ?? null,
        departmentId: dto.departmentId ?? null, passwordHash: await bcrypt.hash(dto.password, 10), roles,
      });
      await m.save(user);
      await this.audit.log(m, me, 'user.create', 'User', user.id, { label: user.email, new: { roles: dto.roleCodes, departmentId: user.departmentId } });
      return publicUser(user);
    });
  }

  async updateUser(id: string, dto: UpdateUserDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const user = await m.findOne(User, { where: { id, deletedAt: IsNull() }, relations: { roles: true, department: true } });
      if (!user) throw new NotFoundException('User not found.');
      const before = { ...user, roles: user.roles.map((r) => r.code) };
      if (dto.roleCodes) user.roles = await this.roles(m, dto.roleCodes);
      if (dto.email && dto.email.toLowerCase() !== user.email) {
        const email = dto.email.toLowerCase();
        if (await emailTaken(m, email, user.id)) throw new BadRequestException({ message: 'Email already in use.', fieldErrors: { email: 'Email already in use.' } });
        user.email = email;
      }
      const { roleCodes, password, email, departmentScopes, ...rest } = dto;
      // DTO fields the client left out are present as undefined; only apply the ones it sent.
      Object.assign(user, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (departmentScopes) user.departmentScopes = await this.scopes(m, departmentScopes);
      if (password) user.passwordHash = await bcrypt.hash(password, 10);

      // Never let an administrator lock themselves out of this screen.
      if (user.id === me.id) {
        const effective = new Set(user.roles.filter((r) => r.active).flatMap((r) => r.permissions));
        user.extraPermissions.forEach((p) => effective.add(p));
        user.deniedPermissions.forEach((p) => effective.delete(p));
        if (!user.active || !effective.has(P.USER_MANAGE)) throw new BadRequestException('You cannot deactivate yourself or remove your own Users & Roles permission.');
      }
      await m.save(user);
      const after = { ...user, roles: user.roles.map((r) => r.code) };
      const d = diff(before, after, ['name', 'email', 'designation', 'departmentId', 'active', 'roles', 'extraPermissions', 'deniedPermissions', 'departmentScopes']);
      if (d.changed.length || password) {
        await this.audit.log(m, me, password ? 'user.update_with_password_reset' : 'user.update', 'User', user.id, { label: user.email, old: d.old, new: { ...d.new, ...(password ? { password: 'reset' } : {}) } });
      }
      return publicUser(user);
    });
  }

  /**
   * Deletes an account but keeps history: it is hidden, signed out and can never sign in, while past requisitions,
   * approvals and audit entries keep showing the name. Refused while the person still has work assigned.
   */
  async deleteUser(id: string, me: AuthUser) {
    if (id === me.id) throw new BadRequestException('You cannot delete your own account.');
    return this.ds.transaction(async (m) => {
      const user = await m.findOne(User, { where: { id, deletedAt: IsNull() }, relations: { roles: true }, lock: { mode: 'pessimistic_write', tables: ['users'] } });
      if (!user) throw new NotFoundException('User not found.');
      const [work] = await m.query(
        `SELECT
           (SELECT count(*)::int FROM approval_route_steps s JOIN approval_routes r ON r.id = s."routeId" WHERE r.active AND s."approverUserId" = $1) AS "routeSteps",
           (SELECT count(*)::int FROM approval_actions a JOIN requisitions q ON q.id = a."requisitionId"
             WHERE a."approverUserId" = $1 AND a.version = q.version AND a.status IN ('Pending', 'Waiting') AND q.status = 'Pending Approval') AS approvals,
           (SELECT count(*)::int FROM vacancies v WHERE v."coordinatorId" = $1 AND v.status NOT IN ('Filled', 'Closed')) AS vacancies`, [id]);
      const blockers = [
        work.routeSteps && `named approver in ${work.routeSteps} approval route step(s) — replace them in Approval Routes`,
        work.approvals && `${work.approvals} approval(s) waiting for them`,
        work.vacancies && `coordinator of ${work.vacancies} open vacanc${work.vacancies === 1 ? 'y' : 'ies'} — reassign in the HR queue or vacancy`,
      ].filter(Boolean);
      if (blockers.length) throw new ConflictException(`${user.name} cannot be deleted yet: ${blockers.join('; ')}.`);
      if (await this.isLastAdministrator(m, user)) throw new BadRequestException('This is the last active account that can manage Users & Roles.');
      await m.update(User, id, { deletedAt: new Date(), active: false });
      await this.audit.log(m, me, 'user.delete', 'User', id, { label: user.email, old: { name: user.name, roles: user.roles.map((r) => r.code), active: user.active } });
      return { ok: true };
    });
  }

  /** Brings a deleted account back as Inactive, so an administrator activates it deliberately. */
  async restoreUser(id: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const user = await m.findOne(User, { where: { id, deletedAt: Not(IsNull()) } });
      if (!user) throw new NotFoundException('Deleted user not found.');
      if (await emailTaken(m, user.email)) throw new ConflictException(`${user.email} is now used by another account; change that account's email first.`);
      await m.update(User, id, { deletedAt: null, active: false });
      await this.audit.log(m, me, 'user.restore', 'User', id, { label: user.email, new: { active: false } });
      const restored = await m.findOneOrFail(User, { where: { id }, relations: { roles: true, department: true } });
      return publicUser(restored);
    });
  }

  private async isLastAdministrator(m: EntityManager, user: User) {
    const others: { n: number }[] = await m.query(
      `SELECT count(DISTINCT u.id)::int AS n FROM users u JOIN user_roles ur ON ur."userId" = u.id JOIN roles r ON r.id = ur."roleId" AND r.active
        WHERE u.active AND u."deletedAt" IS NULL AND u.id <> $1 AND NOT ($2 = ANY(u."deniedPermissions")) AND $2 = ANY(r.permissions)`, [user.id, P.USER_MANAGE]);
    const holds = user.roles.some((r) => r.active && r.permissions.includes(P.USER_MANAGE)) || user.extraPermissions.includes(P.USER_MANAGE);
    return holds && !others[0].n;
  }

  private async roles(m: EntityManager, codes: string[]) {
    const roles = await m.find(Role, { where: { code: In(codes) } });
    if (roles.length !== codes.length) throw new BadRequestException('One or more roles do not exist.');
    return roles;
  }

  /** Keeps only meaningful values (department lists for Custom only) and checks the departments exist. */
  private async scopes(m: EntityManager, dto: DepartmentScopesDto): Promise<DepartmentScopes> {
    const out: DepartmentScopes = {};
    for (const key of SCOPE_MODULES) {
      const s = dto[key];
      if (!s) continue;
      if (s.mode !== 'custom') { out[key] = { mode: s.mode }; continue; }
      const ids = [...new Set(s.departmentIds ?? [])];
      if ((await m.count(Department, { where: { id: In(ids) } })) !== ids.length) throw new BadRequestException('One or more departments do not exist.');
      out[key] = { mode: 'custom', departmentIds: ids };
    }
    return out;
  }

  // ------------------------------------------------------------------ roles

  async rolesList() {
    const roles = await this.ds.getRepository(Role).find({ order: { name: 'ASC' } });
    return roles.map((r) => ({ ...r, builtIn: BUILT_IN_ROLES.has(r.code) }));
  }

  async createRole(dto: CreateRoleDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      if (await m.exists(Role, { where: { code: dto.code } })) throw new BadRequestException({ message: 'A role with this code exists.', fieldErrors: { code: 'Already in use.' } });
      const role = await m.save(Role, m.create(Role, { ...dto, description: dto.description ?? null, active: true }));
      await this.audit.log(m, me, 'role.create', 'Role', role.id, { label: role.code, new: { name: role.name, permissions: role.permissions } });
      return role;
    });
  }

  async updateRole(id: string, dto: UpdateRoleDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const role = await m.findOne(Role, { where: { id } });
      if (!role) throw new NotFoundException('Role not found.');
      if (role.code === 'SUPER_ADMIN' && (dto.active === false || (dto.permissions && !dto.permissions.includes(P.USER_MANAGE)))) {
        throw new BadRequestException('The Super Admin role must stay active and keep Users & Roles.');
      }
      const d = diff(role, { ...role, ...dto }, ['name', 'description', 'active', 'permissions']);
      Object.assign(role, dto);
      await m.save(role);
      if (d.changed.length) await this.audit.log(m, me, 'role.update', 'Role', role.id, { label: role.code, ...d });
      return role;
    });
  }

  /** Custom roles only, and only once nobody (who is not deleted) holds them. */
  async deleteRole(id: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const role = await m.findOne(Role, { where: { id } });
      if (!role) throw new NotFoundException('Role not found.');
      if (BUILT_IN_ROLES.has(role.code)) throw new BadRequestException(`${role.name} is a built-in role; deactivate it instead of deleting it.`);
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM user_roles ur JOIN users u ON u.id = ur."userId" WHERE ur."roleId" = $1 AND u."deletedAt" IS NULL`, [id]);
      if (n) throw new ConflictException(`${n} user(s) still have the role ${role.name}; remove it from them first.`);
      await m.query(`DELETE FROM user_roles WHERE "roleId" = $1`, [id]); // only deleted accounts remain linked
      await m.delete(Role, id);
      await this.audit.log(m, me, 'role.delete', 'Role', id, { label: role.code, old: { name: role.name, permissions: role.permissions } });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ permission & module (group) settings

  /** Saves the label / description (and, for a permission, the off switch) shown for a code or module. */
  async saveSetting(kind: 'permission' | 'module', key: string, dto: PermissionSettingDto, me: AuthUser) {
    if (kind === 'permission' && !(ALL_PERMISSIONS as string[]).includes(key)) throw new NotFoundException('Unknown permission.');
    if (kind === 'module' && !PERMISSION_MATRIX.some((x) => x.key === key)) throw new NotFoundException('Unknown module.');
    if (kind === 'module' && dto.disabled) throw new BadRequestException('Only individual permissions can be switched off.');
    if (key === P.USER_MANAGE && dto.disabled) throw new BadRequestException('Users & Roles cannot be switched off, or nobody could manage permissions.');
    return this.ds.transaction(async (m) => {
      const rec = (await m.findOne(PermissionSetting, { where: { kind, key } })) ?? m.create(PermissionSetting, { kind, key, label: null, description: null, disabled: false });
      const before = { ...rec };
      Object.assign(rec, { label: dto.label?.trim() || null, description: dto.description?.trim() || null, disabled: kind === 'permission' && !!dto.disabled });
      await m.save(rec);
      const d = diff(before, rec, ['label', 'description', 'disabled']);
      if (d.changed.length) await this.audit.log(m, me, `${kind}_setting.update`, 'PermissionSetting', rec.id, { label: key, old: d.old, new: d.new });
      invalidatePermissionSettings();
      return rec;
    });
  }

  /** Back to the built-in label, no description, switched on. */
  async resetSetting(kind: 'permission' | 'module', key: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const rec = await m.findOne(PermissionSetting, { where: { kind, key } });
      if (!rec) return { ok: true };
      await m.delete(PermissionSetting, rec.id);
      await this.audit.log(m, me, `${kind}_setting.reset`, 'PermissionSetting', rec.id, { label: key, old: { label: rec.label, description: rec.description, disabled: rec.disabled } });
      invalidatePermissionSettings();
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ permission templates

  templates() {
    return this.ds.getRepository(PermissionTemplate).find({ order: { name: 'ASC' } });
  }

  async saveTemplate(id: string | null, dto: TemplateDto, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const clash = await m.findOne(PermissionTemplate, { where: { name: dto.name } });
      if (clash && clash.id !== id) throw new ConflictException({ message: 'A template with this name exists.', fieldErrors: { name: 'Already in use.' } });
      const rec = id ? await m.findOne(PermissionTemplate, { where: { id } }) : m.create(PermissionTemplate, {});
      if (!rec) throw new NotFoundException('Template not found.');
      const before = { ...rec };
      Object.assign(rec, { name: dto.name, description: dto.description ?? null, permissions: dto.permissions, departmentScopes: await this.scopes(m, dto.departmentScopes ?? {}) });
      await m.save(rec);
      const d = diff(before, rec, ['name', 'description', 'permissions', 'departmentScopes']);
      await this.audit.log(m, me, id ? 'permission_template.update' : 'permission_template.create', 'PermissionTemplate', rec.id, { label: rec.name, old: id ? d.old : null, new: d.new });
      return rec;
    });
  }

  async deleteTemplate(id: string, me: AuthUser) {
    return this.ds.transaction(async (m) => {
      const rec = await m.findOne(PermissionTemplate, { where: { id } });
      if (!rec) throw new NotFoundException('Template not found.');
      await m.delete(PermissionTemplate, id);
      await this.audit.log(m, me, 'permission_template.delete', 'PermissionTemplate', id, { label: rec.name, old: { permissions: rec.permissions, departmentScopes: rec.departmentScopes } });
      return { ok: true };
    });
  }
}
