import { Controller, Get, INestApplication } from '@nestjs/common';
import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthModule } from '../../../apps/api/src/auth/auth.module';
import { DatabaseModule } from '../../../apps/api/src/database/database.module';
import { JwtAuthGuard } from '../../../apps/api/src/auth/jwt-auth.guard';
import { JwtConfig } from '../../../apps/api/src/auth/jwt.config';
import { Roles } from '../../../apps/api/src/auth/roles.decorator';
import { RolesGuard } from '../../../apps/api/src/auth/roles.guard';

const testSigningSecret = 'roles-e2e-test-signing-secret';
const testUserId = 'b6a05095-6ef7-4f77-b654-6ac6c7d5cf73';
const insufficientRoleResponse = {
  statusCode: 403,
  error: 'Forbidden',
  message: 'Insufficient role',
};

type TokenPayload = Record<string, unknown> & { exp: number; sub: string };

function signHs256Token(payload: TokenPayload): string {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', testSigningSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function validToken(role?: Role): string {
  return signHs256Token({
    sub: testUserId,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...(role === undefined ? {} : { role }),
  });
}

class RolesTestController {
  organizer() {
    return { route: 'organizer' };
  }

  customerOrGate() {
    return { route: 'customer-or-gate' };
  }

  anyAuthenticatedRole() {
    return { route: 'any-authenticated-role' };
  }
}

Controller('roles-test')(RolesTestController);
Get('organizer')(RolesTestController.prototype, 'organizer', Object.getOwnPropertyDescriptor(RolesTestController.prototype, 'organizer'));
Roles(Role.ORGANIZER)(RolesTestController.prototype, 'organizer', Object.getOwnPropertyDescriptor(RolesTestController.prototype, 'organizer'));
Get('customer-or-gate')(
  RolesTestController.prototype,
  'customerOrGate',
  Object.getOwnPropertyDescriptor(RolesTestController.prototype, 'customerOrGate'),
);
Roles(Role.CUSTOMER, Role.GATE)(
  RolesTestController.prototype,
  'customerOrGate',
  Object.getOwnPropertyDescriptor(RolesTestController.prototype, 'customerOrGate'),
);
Get('any-authenticated-role')(
  RolesTestController.prototype,
  'anyAuthenticatedRole',
  Object.getOwnPropertyDescriptor(RolesTestController.prototype, 'anyAuthenticatedRole'),
);

class ControllerRolesTestController {
  inheritedCustomerRole() {
    return { route: 'inherited-customer-role' };
  }

  overriddenOrganizerRole() {
    return { route: 'overridden-organizer-role' };
  }
}

Controller('controller-roles-test')(ControllerRolesTestController);
Roles(Role.CUSTOMER)(ControllerRolesTestController);
Get('inherited-customer-role')(
  ControllerRolesTestController.prototype,
  'inheritedCustomerRole',
  Object.getOwnPropertyDescriptor(ControllerRolesTestController.prototype, 'inheritedCustomerRole'),
);
Get('overridden-organizer-role')(
  ControllerRolesTestController.prototype,
  'overriddenOrganizerRole',
  Object.getOwnPropertyDescriptor(ControllerRolesTestController.prototype, 'overriddenOrganizerRole'),
);
Roles(Role.ORGANIZER)(
  ControllerRolesTestController.prototype,
  'overriddenOrganizerRole',
  Object.getOwnPropertyDescriptor(ControllerRolesTestController.prototype, 'overriddenOrganizerRole'),
);

describe('RolesGuard', () => {
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = testSigningSecret;
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule],
      controllers: [RolesTestController, ControllerRolesTestController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(
      new JwtAuthGuard(new JwtConfig()),
      new RolesGuard(moduleRef.get(Reflector)),
    );
    await app.init();
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

  it('AC-1 permits the declared ORGANIZER role', async () => {
    await request(app.getHttpServer())
      .get('/roles-test/organizer')
      .set('Authorization', `Bearer ${validToken(Role.ORGANIZER)}`)
      .expect(200)
      .expect({ route: 'organizer' });
  });

  it.each([Role.CUSTOMER, Role.GATE])('AC-2 permits %s on a multi-role route', async (role) => {
    await request(app.getHttpServer())
      .get('/roles-test/customer-or-gate')
      .set('Authorization', `Bearer ${validToken(role)}`)
      .expect(200)
      .expect({ route: 'customer-or-gate' });
  });

  it('AC-2 denies ORGANIZER on a CUSTOMER and GATE route', async () => {
    await request(app.getHttpServer())
      .get('/roles-test/customer-or-gate')
      .set('Authorization', `Bearer ${validToken(Role.ORGANIZER)}`)
      .expect(403)
      .expect(insufficientRoleResponse);
  });

  it('AC-3 returns the exact forbidden response for an authenticated disallowed role', async () => {
    await request(app.getHttpServer())
      .get('/roles-test/organizer')
      .set('Authorization', `Bearer ${validToken(Role.GATE)}`)
      .expect(403)
      .expect(insufficientRoleResponse);
  });

  it('AC-4 returns the exact forbidden response when the authenticated token has no role', async () => {
    await request(app.getHttpServer())
      .get('/roles-test/organizer')
      .set('Authorization', `Bearer ${validToken()}`)
      .expect(403)
      .expect(insufficientRoleResponse);
  });

  it.each([Role.ORGANIZER, Role.CUSTOMER, Role.GATE])(
    'AC-5 permits %s on a guarded route without a role declaration',
    async (role) => {
      await request(app.getHttpServer())
        .get('/roles-test/any-authenticated-role')
        .set('Authorization', `Bearer ${validToken(role)}`)
        .expect(200)
        .expect({ route: 'any-authenticated-role' });
    },
  );

  it('AC-6 permits CUSTOMER through a controller-level declaration', async () => {
    await request(app.getHttpServer())
      .get('/controller-roles-test/inherited-customer-role')
      .set('Authorization', `Bearer ${validToken(Role.CUSTOMER)}`)
      .expect(200)
      .expect({ route: 'inherited-customer-role' });
  });

  it('AC-6 denies ORGANIZER through a controller-level declaration', async () => {
    await request(app.getHttpServer())
      .get('/controller-roles-test/inherited-customer-role')
      .set('Authorization', `Bearer ${validToken(Role.ORGANIZER)}`)
      .expect(403)
      .expect(insufficientRoleResponse);
  });

  it('AC-7 permits ORGANIZER when the handler overrides the controller declaration', async () => {
    await request(app.getHttpServer())
      .get('/controller-roles-test/overridden-organizer-role')
      .set('Authorization', `Bearer ${validToken(Role.ORGANIZER)}`)
      .expect(200)
      .expect({ route: 'overridden-organizer-role' });
  });

  it('AC-7 denies CUSTOMER when the handler overrides the controller declaration', async () => {
    await request(app.getHttpServer())
      .get('/controller-roles-test/overridden-organizer-role')
      .set('Authorization', `Bearer ${validToken(Role.CUSTOMER)}`)
      .expect(403)
      .expect(insufficientRoleResponse);
  });

  it('exports only RolesGuard and does not make AuthModule global', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, AuthModule)).not.toBe(true);

    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule) as unknown[];
    expect(exports).toContain(RolesGuard);
    expect(exports).not.toContain(JwtAuthGuard);
    expect(exports).not.toContain(JwtConfig);
  });
});
