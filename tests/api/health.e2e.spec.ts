import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/api/src/app.module';

describe('GET /health', () => {
  let app: INestApplication;
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;

  afterEach(async () => {
    await app?.close();
    if (originalAuthJwtSecret === undefined) {
      delete process.env.AUTH_JWT_SECRET;
    } else {
      process.env.AUTH_JWT_SECRET = originalAuthJwtSecret;
    }
  });

  it('returns the service health status', async () => {
    process.env.AUTH_JWT_SECRET = 'health-test-signing-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
