import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { UsersService } from '../users/users.service';
import { PasswordHasherService } from './password-hasher.service';
import { ACCESS_TOKEN_EXPIRES_IN_SECONDS, JwtConfig } from './jwt.config';

export type LoginResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: 900;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly jwtConfig: JwtConfig,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    if (typeof email !== 'string' || typeof password !== 'string' || email.trim() === '' || password.trim() === '') {
      throw new BadRequestException('email and password must be non-empty strings');
    }

    const user = await this.users.findByEmail(email);
    if (!user || !(await this.passwordHasher.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: user.id, role: user.role, iat: issuedAt, exp: issuedAt + ACCESS_TOKEN_EXPIRES_IN_SECONDS }),
    ).toString('base64url');
    const signedValue = `${header}.${payload}`;
    const signature = createHmac('sha256', this.jwtConfig.secret).update(signedValue).digest('base64url');

    return {
      accessToken: `${signedValue}.${signature}`,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    };
  }
}
