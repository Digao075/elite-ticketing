import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';

const testSigningSecret = 'authentication-e2e-test-signing-secret';
const invalidTokenResponse = {
  statusCode: 401,
  error: 'Unauthorized',
  message: 'Invalid or expired access token',
};
const gateUserId = 'b6a05095-6ef7-4f77-b654-6ac6c7d5cf73';

type TokenPayload = Record<string, unknown> & { exp: number };

function signHs256Token(payload: TokenPayload, secret = testSigningSecret, algorithm = 'HS256'): string {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function validToken(overrides: Record<string, unknown> = {}): string {
  return signHs256Token({ sub: gateUserId, role: Role.GATE, exp: Math.floor(Date.now() / 1000) + 60, ...overrides });
}

describe('GET /auth/me', () => {
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = testSigningSecret;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    try {
      await app?.close();
      await moduleRef?.close();
    } finally {
      if (originalAuthJwtSecret === undefined) {
        delete process.env.AUTH_JWT_SECRET;
      } else {
        process.env.AUTH_JWT_SECRET = originalAuthJwtSecret;
      }
    }
  });

  it('AC-1 returns the signed GATE identity for a valid bearer token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${validToken()}`)
      .expect(200)
      .expect({ id: gateUserId, role: 'GATE' });
  });

  it.each([
    ['a missing Authorization header', undefined],
    ['a Basic authorization scheme', 'Basic abc'],
    ['a bearer scheme without a token', 'Bearer'],
    ['a malformed bearer token', 'Bearer not-a-jwt'],
  ])('AC-2 returns the exact unauthorized response for %s', async (_description, authorization) => {
    const response = request(app.getHttpServer()).get('/auth/me');
    if (authorization !== undefined) {
      response.set('Authorization', authorization);
    }

    await response.expect(401).expect(invalidTokenResponse);
  });

  it.each([
    ['an expired token', signHs256Token({ sub: gateUserId, role: Role.GATE, exp: Math.floor(Date.now() / 1000) - 1 })],
    ['a token signed with another secret', signHs256Token({ sub: gateUserId, role: Role.GATE, exp: Math.floor(Date.now() / 1000) + 60 }, 'another-secret')],
    ['a token with a non-HS256 algorithm', signHs256Token({ sub: gateUserId, role: Role.GATE, exp: Math.floor(Date.now() / 1000) + 60 }, testSigningSecret, 'HS384')],
  ])('AC-3 returns the exact unauthorized response for %s', async (_description, token) => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
      .expect(invalidTokenResponse);
  });

  it.each([
    ['an absent sub claim', validToken({ sub: undefined })],
    ['a null sub claim', validToken({ sub: null })],
    ['a non-string sub claim', validToken({ sub: 7 })],
    ['a non-UUID sub claim', validToken({ sub: 'not-a-uuid' })],
  ])('AC-4 returns the exact unauthorized response for %s', async (_description, token) => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
      .expect(invalidTokenResponse);
  });

  it('AC-5 derives the identity from verified claims without querying Prisma users', async () => {
    const findUnique = vi.spyOn(prisma.user, 'findUnique');
    const findFirst = vi.spyOn(prisma.user, 'findFirst');
    const findUniqueOrThrow = vi.spyOn(prisma.user, 'findUniqueOrThrow');

    try {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${validToken()}`)
        .expect(200)
        .expect({ id: gateUserId, role: 'GATE' });

      expect(findUnique).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
      expect(findUniqueOrThrow).not.toHaveBeenCalled();
    } finally {
      findUnique.mockRestore();
      findFirst.mockRestore();
      findUniqueOrThrow.mockRestore();
    }
  });

  it('preserves unauthenticated access to GET /health', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('preserves unauthenticated access to POST /auth/login validation', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
  });
});
