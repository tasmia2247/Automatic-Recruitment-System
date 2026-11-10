import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../database/entities';

/**
 * Failed sign-ins (security test, 2026-11-05): after LIMIT_PER_CLIENT wrong passwords for one email from one address, or
 * LIMIT_PER_EMAIL from anywhere, within WINDOW_MS, that email is refused with 429 until the window has passed. A successful
 * sign-in clears the client's count. Kept in memory, so each API instance counts on its own and a restart clears it.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LIMIT_PER_CLIENT = 5;
export const LOGIN_LIMIT_PER_EMAIL = 20;

/** Compared when the email is unknown, so a wrong email takes as long as a wrong password and does not reveal which accounts exist. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

@Injectable()
export class AuthService {
  private readonly failures = new Map<string, number[]>();

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string, client = '') {
    const key = email.trim().toLowerCase();
    this.refuseIfLocked(key, client);
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash')
      .leftJoinAndSelect('u.roles', 'r').where('lower(u.email) = lower(:email)', { email: key }).andWhere('u.deletedAt IS NULL').getOne();
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    // Same message for unknown user / wrong password to avoid account enumeration.
    if (!user || !user.active || !ok) {
      this.recordFailure(key, client);
      throw new UnauthorizedException('Invalid email or password.');
    }
    this.failures.delete(`${key}|${client}`);
    await this.users.update(user.id, { lastLoginAt: new Date() });
    // `iatMs`: when the token was issued, to the millisecond, so a sign-out in the same second as the sign-in still ends it.
    const token = await this.jwt.signAsync({ sub: user.id, iatMs: Date.now() });
    return { token, user };
  }

  private recent(k: string, now: number) {
    const list = (this.failures.get(k) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (list.length) this.failures.set(k, list); else this.failures.delete(k);
    return list;
  }

  private refuseIfLocked(email: string, client: string) {
    const now = Date.now();
    const perClient = this.recent(`${email}|${client}`, now);
    const perEmail = this.recent(email, now);
    const blocking = perClient.length >= LOGIN_LIMIT_PER_CLIENT ? perClient : perEmail.length >= LOGIN_LIMIT_PER_EMAIL ? perEmail : null;
    if (!blocking) return;
    const minutes = Math.max(1, Math.ceil((blocking[0] + LOGIN_WINDOW_MS - now) / 60000));
    throw new HttpException(`Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator to reset the password.`, HttpStatus.TOO_MANY_REQUESTS);
  }

  private recordFailure(email: string, client: string) {
    const now = Date.now();
    for (const k of [`${email}|${client}`, email]) this.failures.set(k, [...this.recent(k, now), now]);
    // Keep the map small: drop anything older than the window once it grows.
    if (this.failures.size > 10000) for (const k of [...this.failures.keys()]) this.recent(k, now);
  }
}
