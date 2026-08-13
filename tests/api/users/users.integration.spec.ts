import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';
import { UsersService } from '../../../apps/api/src/users/users.service';

type TestDatabaseRunnerModule = {
  assertDedicatedTestDatabaseUrl(databaseUrl: string | undefined): URL;
};

async function loadTestDatabaseRunner(): Promise<TestDatabaseRunnerModule> {
  return import(new URL('../../../scripts/run-tests.mjs', import.meta.url).href) as Promise<TestDatabaseRunnerModule>;
}

describe('UsersService PostgreSQL integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  const createdFixtureIds: string[] = [];
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  let sentinel: Awaited<ReturnType<PrismaService['user']['findUniqueOrThrow']>>;

  beforeAll(async () => {
    const { assertDedicatedTestDatabaseUrl } = await loadTestDatabaseRunner();
    assertDedicatedTestDatabaseUrl(process.env.DATABASE_URL);
    process.env.AUTH_JWT_SECRET = 'users-integration-test-signing-secret';

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    users = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);

    const sentinelUser = await users.create({
      email: 'sentinel@example.com',
      passwordHash: 'sentinel-hash',
      role: Role.CUSTOMER,
    });
    sentinel = await prisma.user.findUniqueOrThrow({ where: { id: sentinelUser.id } });
  });

  afterAll(async () => {
    try {
      if (prisma && sentinel) {
        await prisma.user.deleteMany({ where: { id: { in: createdFixtureIds } } });

        await expect(prisma.user.findMany({ where: { id: { in: createdFixtureIds } } })).resolves.toEqual([]);
        await expect(prisma.user.findUniqueOrThrow({ where: { id: sentinel.id } })).resolves.toEqual(sentinel);
      }
    } finally {
      await prisma?.$disconnect();
      await moduleRef?.close();
      if (originalAuthJwtSecret === undefined) {
        delete process.env.AUTH_JWT_SECRET;
      } else {
        process.env.AUTH_JWT_SECRET = originalAuthJwtSecret;
      }
    }
  });

  async function createFixture(input: Parameters<UsersService['create']>[0]) {
    const user = await users.create(input);
    createdFixtureIds.push(user.id);
    return user;
  }

  it('AC-1 persists a normalized identity with its supplied password hash and role', async () => {
    const user = await createFixture({
      email: '  Organizer@Example.COM ',
      passwordHash: 'opaque-hash',
      role: Role.ORGANIZER,
    });

    expect(user).toMatchObject({
      email: 'organizer@example.com',
      passwordHash: 'opaque-hash',
      role: Role.ORGANIZER,
    });
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      email: 'organizer@example.com',
      passwordHash: 'opaque-hash',
      role: Role.ORGANIZER,
    });
  });

  it('AC-2 rejects a duplicate normalized email with the exact conflict response and retains one row', async () => {
    await createFixture({
      email: '  Duplicate@Example.COM ',
      passwordHash: 'opaque-hash',
      role: Role.ORGANIZER,
    });

    let thrown: unknown;
    try {
      await users.create({
        email: 'DUPLICATE@example.com',
        passwordHash: 'another-opaque-hash',
        role: Role.ORGANIZER,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'A user with this email already exists',
    });
    await expect(prisma.user.count({ where: { email: 'duplicate@example.com' } })).resolves.toBe(1);
  });

  it('AC-3 finds a stored email after normalization and returns null for an unknown email', async () => {
    const created = await createFixture({
      email: 'customer@example.com',
      passwordHash: 'customer-hash',
      role: Role.CUSTOMER,
    });

    await expect(users.findByEmail('customer@example.com')).resolves.toMatchObject({ id: created.id });
    await expect(users.findByEmail('  CUSTOMER@EXAMPLE.COM ')).resolves.toMatchObject({ id: created.id });
    await expect(users.findByEmail('unknown@example.com')).resolves.toBeNull();
  });

  it('AC-4 returns only the approved fields with a canonical UUID and database timestamps', async () => {
    const user = await createFixture({
      email: 'gate@example.com',
      passwordHash: 'gate-hash',
      role: Role.GATE,
    });

    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(Object.keys(user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'passwordHash',
      'role',
      'updatedAt',
    ]);
  });

  it('AC-5 rejects a database row with a role outside the approved enum', async () => {
    let thrown: unknown;

    try {
      await prisma.$executeRaw`
        INSERT INTO "User" ("email", "passwordHash", "role", "updatedAt")
        VALUES (${'invalid-role@example.com'}, ${'invalid-role-hash'}, ${'ADMIN'}::"Role", ${new Date()})
      `;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((thrown as Prisma.PrismaClientKnownRequestError).code).toBe('P2010');
    expect((thrown as Prisma.PrismaClientKnownRequestError).meta).toMatchObject({ code: '22P02' });
    expect((thrown as Error).message).toContain('invalid input value for enum "Role": "ADMIN"');
  });
});
