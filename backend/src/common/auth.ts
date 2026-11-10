import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, Logger, SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartmentScopes, User } from '../database/entities';
import { Permission } from './permissions';

export const AUTH_COOKIE = 'ars_token';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  roles: string[];
  permissions: Set<string>;
  /** Per-user Access Scope overrides; modules not listed follow the role default (see departmentScope). */
  scopes: DepartmentScopes;
}

/** Permissions switched off system-wide (Users & Roles → Permissions). Cached briefly; cleared when an admin changes one. */
let disabledCache: { codes: Set<string>; at: number } | null = null;
export function invalidatePermissionSettings() {
  disabledCache = null;
}
async function disabledPermissions(repo: Repository<User>) {
  if (!disabledCache || Date.now() - disabledCache.at > 30_000) {
    const rows: { key: string }[] = await repo.manager.query(`SELECT key FROM permission_settings WHERE kind = 'permission' AND disabled`);
    disabledCache = { codes: new Set(rows.map((r) => r.key)), at: Date.now() };
  }
  return disabledCache.codes;
}

export function effectivePermissions(user: User): Set<string> {
  const set = new Set<string>();
  // Role.active is a role-picker gate only (legacy roles hidden from new assignments). A user who still holds
  // an inactive role keeps its permissions, so admins can migrate users off splinter roles without a flash of 403s.
  for (const r of user.roles ?? []) r.permissions.forEach((p) => set.add(p));
  user.extraPermissions?.forEach((p) => set.add(p));
  user.deniedPermissions?.forEach((p) => set.delete(p));
  return set;
}

const IS_PUBLIC = 'isPublic';
const PERMS = 'permissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requires ALL listed permissions. Enforced server-side for every route (SRS 3.1, AC-24). */
export const RequirePerm = (...perms: Permission[]) => SetMetadata(PERMS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('Access');

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = req.cookies?.[AUTH_COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!token) throw new UnauthorizedException('Please sign in.');

    let payload: { sub: string; iat?: number; iatMs?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    const user = await this.users.findOne({ where: { id: payload.sub }, relations: { roles: true } });
    if (!user || !user.active || user.deletedAt) throw new UnauthorizedException('Account is inactive.');
    // A token from before the last sign-out or password reset is no longer valid. Tokens carry `iatMs`; older ones only whole-second `iat`.
    const issuedMs = payload.iatMs ?? (payload.iat ?? 0) * 1000;
    if (user.sessionsValidFrom && issuedMs < user.sessionsValidFrom.getTime()) {
      throw new UnauthorizedException('Your session has ended. Please sign in again.');
    }

    const permissions = effectivePermissions(user);
    for (const code of await disabledPermissions(this.users)) permissions.delete(code);
    const authUser: AuthUser = {
      id: user.id, name: user.name, email: user.email, departmentId: user.departmentId,
      roles: user.roles.map((r) => r.code), permissions,
      scopes: user.departmentScopes ?? {},
    };
    req.user = authUser;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets) ?? [];
    const missing = required.filter((p) => !authUser.permissions.has(p));
    if (missing.length) {
      this.logger.warn(`Denied ${req.method} ${req.originalUrl} for ${user.email}: missing ${missing.join(', ')}`);
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return true;
  }
}

export function hasPerm(user: AuthUser, p: Permission) {
  return user.permissions.has(p);
}

export function assertPerm(user: AuthUser, p: Permission, message?: string) {
  if (!user.permissions.has(p)) throw new ForbiddenException(message ?? 'You do not have permission to perform this action.');
}
