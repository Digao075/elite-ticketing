import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AuthenticatedRequest } from './authenticated-principal';
import { JwtConfig } from './jwt.config';

const INVALID_ACCESS_TOKEN_MESSAGE = 'Invalid or expired access token';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtConfig: JwtConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    try {
      const token = this.extractBearerToken(request.headers.authorization);
      const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
      const header = this.parseJson(encodedHeader) as { alg?: unknown };
      const payload = this.parseJson(encodedPayload) as { sub?: unknown; role?: unknown; exp?: unknown };

      if (header.alg !== 'HS256' || !this.hasValidSignature(encodedHeader, encodedPayload, encodedSignature)) {
        throw new Error('Invalid token');
      }

      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) {
        throw new Error('Expired token');
      }

      if (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
        throw new Error('Invalid subject');
      }

      request.user = {
        id: payload.sub,
        ...(typeof payload.role === 'string' ? { role: payload.role as AuthenticatedRequest['user']['role'] } : {}),
      };
      return true;
    } catch {
      throw new UnauthorizedException(INVALID_ACCESS_TOKEN_MESSAGE);
    }
  }

  private extractBearerToken(authorization: string | undefined): string {
    const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
    if (!match) {
      throw new Error('Missing bearer token');
    }

    return match[1];
  }

  private parseJson(value: string): unknown {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Invalid JWT segment');
    }

    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  }

  private hasValidSignature(encodedHeader: string, encodedPayload: string, encodedSignature: string): boolean {
    if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
      return false;
    }

    const expectedSignature = createHmac('sha256', this.jwtConfig.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const providedSignature = Buffer.from(encodedSignature, 'base64url');

    return providedSignature.length === expectedSignature.length && timingSafeEqual(providedSignature, expectedSignature);
  }
}
