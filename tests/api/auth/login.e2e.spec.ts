import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { PasswordHasherService } from '../../../apps/api/src/auth/password-hasher.service';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';
import { UsersService } from '../../../apps/api/src/users/users.service';

const testSigningSecret = 'login-e2e-test-signing-secret';
const customerEmail = 'customer@example.com';
const correctPassword = 'correct-password';

type JwtPayload = {
  [key: string]: unknown;
  exp: number;
  iat: number;
  role: string;
  sub: string;
};

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function verifyHs256Token(token: string, secret: string): { header: Record<string, unknown>; payload: JwtPayload } {
  const parts = token.split('.');
  expect(parts).toHaveLength(3);

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  expect(timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))).toBe(true);

  return {
    header: JSON.parse(decodeBase64Url(encodedHeader)) as Record<string, unknown>,
    payload: JSON.parse(decodeBase64Url(encodedPayload)) as JwtPayload,
  };
}

describe('POST /auth/login', () => {
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  const createdFixtureIds: string[] = [];
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let customer: { id: string };

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = testSigningSecret;

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const users = moduleRef.get(UsersService);
    const passwordHasher = new PasswordHasherService();
    prisma = moduleRef.get(PrismaService);
    customer = await users.create({
      email: customerEmail,
      passwordHash: await passwordHasher.hash(correctPassword),
      role: Role.CUSTOMER,
    });
    createdFixtureIds.push(customer.id);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.user.deleteMany({ where: { id: { in: createdFixtureIds } } });
        await expect(prisma.user.findMany({ where: { id: { in: createdFixtureIds } } })).resolves.toEqual([]);
      }
    } finally {
      await app?.close();
      await moduleRef?.close();
      if (originalAuthJwtSecret === undefined) {
        delete process.env.AUTH_JWT_SECRET;
      } else {
        process.env.AUTH_JWT_SECRET = originalAuthJwtSecret;
      }
    }
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('AC-1 rejects module construction when AUTH_JWT_SECRET is %s', async (_description, secret) => {
    const previousSecret = process.env.AUTH_JWT_SECRET;
    let module: TestingModule | undefined;
    let thrown: unknown;
    if (secret === undefined) {
      delete process.env.AUTH_JWT_SECRET;
    } else {
      process.env.AUTH_JWT_SECRET = secret;
    }

    try {
      module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    } catch (error) {
      thrown = error;
    } finally {
      await module?.close();
      if (previousSecret === undefined) {
        delete process.env.AUTH_JWT_SECRET;
      } else {
        process.env.AUTH_JWT_SECRET = previousSecret;
      }
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('AUTH_JWT_SECRET is required');
  });

  it('AC-1 compiles a module when AUTH_JWT_SECRET is non-whitespace', async () => {
    const previousSecret = process.env.AUTH_JWT_SECRET;
    let validModule: TestingModule | undefined;
    process.env.AUTH_JWT_SECRET = testSigningSecret;

    try {
      validModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    } finally {
      await validModule?.close();
      if (previousSecret === undefined) {
        delete process.env.AUTH_JWT_SECRET;
      } else {
        process.env.AUTH_JWT_SECRET = previousSecret;
      }
    }
  });

  it('AC-2 returns the exact access-token login response for normalized credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: '  CUSTOMER@EXAMPLE.COM ', password: correctPassword })
      .expect(200);

    expect(response.body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(response.body.accessToken).not.toBe('');
  });

  it('AC-3 signs the login token with HS256 and the required claims only', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: '  CUSTOMER@EXAMPLE.COM ', password: correctPassword })
      .expect(200);
    const { header, payload } = verifyHs256Token(response.body.accessToken, testSigningSecret);

    expect(header.alg).toBe('HS256');
    expect(payload).toMatchObject({ sub: customer.id, role: Role.CUSTOMER });
    expect(Number.isInteger(payload.iat)).toBe(true);
    expect(Number.isInteger(payload.exp)).toBe(true);
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('passwordHash');
  });

  it.each([
    ['an unknown email', { email: 'unknown@example.com', password: correctPassword }],
    ['an incorrect password', { email: customerEmail, password: 'incorrect-password' }],
  ])('AC-4 returns the indistinguishable credential error for %s', async (_description, body) => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(401)
      .expect({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' });
  });

  it.each([
    {},
    { email: '', password: 'x' },
    { email: 'x', password: '' },
    { email: 7, password: 'x' },
    { email: 'x', password: 7 },
  ])('AC-5 returns the exact validation error for invalid login bodies', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(400)
      .expect({ statusCode: 400, error: 'Bad Request', message: 'email and password must be non-empty strings' });
  });
});
