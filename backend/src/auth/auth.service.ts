import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../database/entities';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash')
      .leftJoinAndSelect('u.roles', 'r').where('lower(u.email) = lower(:email)', { email }).andWhere('u.deletedAt IS NULL').getOne();
    // Same message for unknown user / wrong password to avoid account enumeration.
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    await this.users.update(user.id, { lastLoginAt: new Date() });
    const token = await this.jwt.signAsync({ sub: user.id });
    return { token, user };
  }
}
