import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { config } from '../config';
import { AUTH_COOKIE, AuthUser, CurrentUser, effectivePermissions, Public } from '../common/auth';
import { SCOPE_MODULES } from '../common/permission-matrix';
import { resolveScope } from '../common/scope';
import { User } from '../database/entities';
import { LoginDto } from './auth.dto';
import { AuthService } from './auth.service';

export function publicUser(u: User) {
  return {
    id: u.id, name: u.name, email: u.email, designation: u.designation, active: u.active,
    departmentId: u.departmentId, department: u.department ? { id: u.department.id, name: u.department.name } : null,
    roles: (u.roles ?? []).map((r) => ({ code: r.code, name: r.name })),
    extraPermissions: u.extraPermissions, deniedPermissions: u.deniedPermissions, departmentScopes: u.departmentScopes ?? {},
    lastLoginAt: u.lastLoginAt,
  };
}

/** See config.cookieSecure. The web app proxies /api, and Next passes the browser's protocol on as X-Forwarded-Proto. */
function cookieSecure(req: Request) {
  if (config.cookieSecure !== 'auto') return config.cookieSecure === 'true';
  return req.secure || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
}

/** The browser's address: the web app's /api proxy puts it first in X-Forwarded-For; otherwise the socket's. */
function clientAddress(req: Request) {
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip || '';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @InjectRepository(User) private readonly users: Repository<User>) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto.email, dto.password, clientAddress(req));
    res.cookie(AUTH_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure(req), path: '/' });
    return { user: publicUser(user), permissions: [...effectivePermissions(user)] };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** The signed-in user, their permissions and, per department-owned module, the departments they may see (null = all). */
  @Get('me')
  async me(@CurrentUser() me: AuthUser) {
    const user = await this.users.findOneOrFail({ where: { id: me.id }, relations: { roles: true, department: true } });
    // null = all departments; "own department" without a department means none.
    const scopes = Object.fromEntries(SCOPE_MODULES.map((m) => { const s = resolveScope(me, m); return [m, s === undefined ? [] : s]; }));
    return { user: publicUser(user), permissions: [...me.permissions], scopes };
  }
}
