import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { CONTENT_SELECTION_CLOCK } from '../../../apps/api/src/catalog/content-selection-token.service';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';
import { EVENTS_CLOCK } from '../../../apps/api/src/events/events.service';
import { TMDB_FETCH, type TmdbFetch } from '../../../apps/api/src/catalog/tmdb-catalog.service';

const authSecret = 'event-creation-auth-secret';
const selectionSecret = 'event-creation-selection-secret';
const now = new Date('2030-01-01T00:00:00.000Z');
const startsAt = '2030-01-02T20:00:00-03:00';
const key = '11111111-1111-4111-8111-111111111111';

const unauthorized = { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired access token' };
const forbidden = { statusCode: 403, error: 'Forbidden', message: 'Insufficient role' };
const invalidToken = { statusCode: 400, error: 'Bad Request', message: 'selectionToken is invalid or expired' };
const idempotencyConflict = {
  statusCode: 409,
  error: 'Conflict',
  message: 'Idempotency-Key was already used with a different request',
};
const unavailable = { statusCode: 409, error: 'Conflict', message: 'Auditorium is unavailable for the requested time' };

type SelectionContent = {
  providerMovieId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  runtimeMinutes: number;
  genres: string[];
  originalLanguage: string;
};

type PublicCatalogProviderMethodSpy = {
  name: string;
  spy: {
    mockClear(): unknown;
    mockRestore(): unknown;
  };
};

function observePublicCatalogProviderMethods(moduleRef: TestingModule): PublicCatalogProviderMethodSpy[] {
  type ProviderWrapper = { instance?: unknown; metatype?: { name?: string } };
  type NestModule = { providers: Map<unknown, ProviderWrapper> };
  type NestContainer = { getModules(): Map<unknown, NestModule> };
  const container = (moduleRef as unknown as { container: NestContainer }).container;
  const observed: PublicCatalogProviderMethodSpy[] = [];

  for (const nestModule of container.getModules().values()) {
    for (const wrapper of nestModule.providers.values()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      const providerName = wrapper.metatype?.name ?? instance?.constructor?.name ?? '';
      if (!/^Tmdb.*Catalog.*Service$/i.test(providerName) || instance === undefined) continue;

      for (const methodName of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
        if (methodName === 'constructor' || typeof instance[methodName] !== 'function') continue;
        const spy = vi.spyOn(instance as Record<string, () => unknown>, methodName);
        observed.push({ name: `${providerName}.${methodName}`, spy });
      }
    }
  }

  return observed;
}

const content: SelectionContent = {
  providerMovieId: 550,
  title: 'Clube da Luta',
  releaseDate: '1999-10-15',
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
  overview: 'Um retrato da insônia.',
  runtimeMinutes: 120,
  genres: ['Drama', 'Thriller'],
  originalLanguage: 'en',
};

function signedSelection(overrides: Partial<SelectionContent & { version: number; issuedAt: number; expiresAt: number }> = {}): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = { ...content, version: 1, issuedAt, expiresAt: issuedAt + 1_800, ...overrides };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', selectionSecret)
    .update(`elite-ticketing:content-selection:v1.${encoded}`, 'utf8')
    .digest('base64url');
  return `v1.${encoded}.${signature}`;
}

function bearer(userId: string, role: Role = Role.ORGANIZER): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

function body(overrides: Record<string, unknown> = {}) {
  return { providerMovieId: 550, selectionToken: signedSelection(), startsAt, venueName: '  Cinema  Elite  ', auditoriumName: '  Sala  1  ', ...overrides };
}

describe('POST /events', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tmdbFetch: ReturnType<typeof vi.fn<TmdbFetch>>;
  let catalogProviderMethodSpies: PublicCatalogProviderMethodSpy[];
  const userIds: string[] = [];
  const previousAuthSecret = process.env.AUTH_JWT_SECRET;
  const previousSelectionSecret = process.env.CONTENT_SELECTION_SECRET;
  const previousTmdbApiKey = process.env.TMDB_API_KEY;

  async function organizer(): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({ data: { id, email: `${id}@example.test`, passwordHash: 'opaque', role: Role.ORGANIZER } });
    return id;
  }

  async function eventCount(): Promise<number> {
    return (prisma as unknown as { event: { count(): Promise<number> } }).event.count();
  }

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = authSecret;
    process.env.CONTENT_SELECTION_SECRET = selectionSecret;
    process.env.TMDB_API_KEY = 'test-only-inert-tmdb-key';
    tmdbFetch = vi.fn<TmdbFetch>();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONTENT_SELECTION_CLOCK).useValue(() => now)
      .overrideProvider(EVENTS_CLOCK).useValue(() => now)
      .overrideProvider(TMDB_FETCH).useValue(tmdbFetch)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    catalogProviderMethodSpies = observePublicCatalogProviderMethods(moduleRef);
    expect(catalogProviderMethodSpies.map(({ name }) => name)).not.toEqual([]);
  });

  beforeEach(async () => {
    const events = prisma as unknown as { event: { deleteMany(input: unknown): Promise<unknown> } };
    await events.event.deleteMany({ where: { organizerId: { in: userIds } } });
  });

  afterAll(async () => {
    try {
      const events = prisma as unknown as { event: { deleteMany(input: unknown): Promise<unknown> } };
      await events.event.deleteMany({ where: { organizerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      catalogProviderMethodSpies?.forEach(({ spy }) => spy.mockRestore());
      await app?.close();
      await moduleRef?.close();
      if (previousAuthSecret === undefined) delete process.env.AUTH_JWT_SECRET; else process.env.AUTH_JWT_SECRET = previousAuthSecret;
      if (previousSelectionSecret === undefined) delete process.env.CONTENT_SELECTION_SECRET; else process.env.CONTENT_SELECTION_SECRET = previousSelectionSecret;
      if (previousTmdbApiKey === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = previousTmdbApiKey;
    }
  });

  it('AC-1 creates the exact DRAFT DTO, stores its immutable typed snapshot, and never calls the catalog provider', async () => {
    const organizerId = await organizer();
    tmdbFetch.mockClear();
    catalogProviderMethodSpies.forEach(({ spy }) => spy.mockClear());
    const response = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', key).send(body()).expect(201);

    expect(response.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      status: 'DRAFT', organizerId, startsAt: '2030-01-02T23:00:00.000Z', venueName: 'Cinema  Elite', auditoriumName: 'Sala  1',
      content, createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/), updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/),
    });
    expect(Object.keys(response.body).sort()).toEqual(['auditoriumName', 'content', 'createdAt', 'id', 'organizerId', 'startsAt', 'status', 'updatedAt', 'venueName']);
    expect(tmdbFetch).not.toHaveBeenCalled();
    for (const { name, spy } of catalogProviderMethodSpies) expect(spy, name).not.toHaveBeenCalled();
    const events = prisma as unknown as { event: { findUniqueOrThrow(input: unknown): Promise<Record<string, unknown>> } };
    await expect(eventCount()).resolves.toBe(1);
    await expect(events.event.findUniqueOrThrow({ where: { id: response.body.id } })).resolves.toMatchObject({
      organizerId, idempotencyKey: key, startsAt: new Date('2030-01-02T23:00:00.000Z'), movieEndsAt: new Date('2030-01-03T01:00:00.000Z'), occupiedUntil: new Date('2030-01-03T01:15:00.000Z'),
      venueName: 'Cinema  Elite', auditoriumName: 'Sala  1', venueKey: 'cinema elite', auditoriumKey: 'sala 1', contentProviderMovieId: 550,
      status: 'DRAFT', contentTitle: content.title, contentReleaseDate: content.releaseDate, contentPosterPath: content.posterPath,
      contentBackdropPath: content.backdropPath, contentOverview: content.overview, contentRuntimeMinutes: content.runtimeMinutes,
      contentGenres: content.genres, contentOriginalLanguage: content.originalLanguage,
      createdAt: expect.any(Date), updatedAt: expect.any(Date),
    });
    const stored = await events.event.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored).not.toHaveProperty('capacity');
    expect(response.body).not.toHaveProperty('movieEndsAt');
    expect(response.body).not.toHaveProperty('occupiedUntil');
  });

  it.each([
    ['missing authentication', undefined, body(), undefined, unauthorized],
    ['invalid authentication', 'Bearer invalid', body(), key, unauthorized],
    ['customer authentication', bearer(randomUUID(), Role.CUSTOMER), body(), key, forbidden],
    ['gate authentication', bearer(randomUUID(), Role.GATE), body(), key, forbidden],
  ])('AC-2 runs guards before validation for %s', async (_description, authorization, requestBody, idempotencyKey, expected) => {
    const before = await eventCount();
    const call = request(app.getHttpServer()).post('/events').send(requestBody);
    if (authorization) call.set('Authorization', authorization);
    if (idempotencyKey) call.set('Idempotency-Key', idempotencyKey);
    await call.expect(expected.statusCode).expect(expected);
    await expect(eventCount()).resolves.toBe(before);
  });

  it.each([
    ['non-object body', [], undefined, 'request body must be a JSON object'],
    ['lexicographically first unknown property', { ...body(), zebra: true, apple: true }, key, 'property apple should not exist'],
    ['zero provider ID', body({ providerMovieId: 0 }), key, 'providerMovieId must be a positive 32-bit integer'],
    ['provider ID above 32-bit maximum', body({ providerMovieId: 2_147_483_648 }), key, 'providerMovieId must be a positive 32-bit integer'],
    ['missing selection token', body({ selectionToken: undefined }), key, 'selectionToken is invalid or expired'],
    ['past start time', body({ startsAt: '2030-01-01T00:00:00Z' }), key, 'startsAt must be a future RFC 3339 timestamp with an explicit UTC offset'],
    ['timestamp without seconds', body({ startsAt: '2030-01-02T20:00-03:00' }), key, 'startsAt must be a future RFC 3339 timestamp with an explicit UTC offset'],
    ['calendar-impossible timestamp', body({ startsAt: '2030-02-30T20:00:00Z' }), key, 'startsAt must be a future RFC 3339 timestamp with an explicit UTC offset'],
    ['blank venue', body({ venueName: '   ' }), key, 'venueName must contain 1 to 120 characters after trimming and no control characters'],
    ['121-character trimmed venue', body({ venueName: 'x'.repeat(121) }), key, 'venueName must contain 1 to 120 characters after trimming and no control characters'],
    ['control-character venue', body({ venueName: 'Cinema\u0000' }), key, 'venueName must contain 1 to 120 characters after trimming and no control characters'],
    ['blank auditorium', body({ auditoriumName: '   ' }), key, 'auditoriumName must contain 1 to 80 characters after trimming and no control characters'],
    ['81-character trimmed auditorium', body({ auditoriumName: 'x'.repeat(81) }), key, 'auditoriumName must contain 1 to 80 characters after trimming and no control characters'],
    ['missing idempotency key', body(), undefined, 'Idempotency-Key must be a UUID'],
    ['wrong UUID version', body(), '11111111-1111-0111-8111-111111111111', 'Idempotency-Key must be a UUID'],
  ])('AC-2 returns the first exact validation message for %s and inserts no row', async (_description, requestBody, idempotencyKey, message) => {
    const organizerId = await organizer();
    const before = await eventCount();
    const call = request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).send(requestBody);
    if (idempotencyKey) call.set('Idempotency-Key', idempotencyKey);
    await call.expect(400).expect({ statusCode: 400, error: 'Bad Request', message });
    await expect(eventCount()).resolves.toBe(before);
  });

  it.each([
    ['invalid time', body({ selectionToken: 'not-a-token', startsAt: '2030-01-01T00:00:00Z' }), key],
    ['invalid venue', body({ selectionToken: 'not-a-token', venueName: '   ' }), key],
    ['invalid auditorium', body({ selectionToken: 'not-a-token', auditoriumName: '   ' }), key],
    ['invalid idempotency header', body({ selectionToken: 'not-a-token' }), 'not-a-uuid'],
  ])('AC-2 gives invalid selection-token precedence over %s', async (_description, requestBody, idempotencyKey) => {
    const organizerId = await organizer(); const before = await eventCount();
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', idempotencyKey).send(requestBody).expect(400).expect(invalidToken);
    await expect(eventCount()).resolves.toBe(before);
  });

  it('AC-2 accepts Unicode names, boundary lengths, case-insensitive UUID headers, and preserves internal whitespace', async () => {
    const organizerId = await organizer();
    const response = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('idempotency-key', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')
      .send(body({ venueName: `  ${'ü'.repeat(120)}  `, auditoriumName: `  ${'演'.repeat(80)}  ` })).expect(201);
    expect(response.body.venueName).toBe('ü'.repeat(120));
    expect(response.body.auditoriumName).toBe('演'.repeat(80));
  });

  it.each([
    ['wrong version', signedSelection({ version: 2 })], ['expired', signedSelection({ issuedAt: 1, expiresAt: 1801 })],
    ['malformed', 'not-a-token'], ['tampered', `${signedSelection().slice(0, -1)}x`], ['movie mismatch', signedSelection({ providerMovieId: 551 })],
    ['runtime above the signed 32-bit maximum', signedSelection({ runtimeMinutes: 2_147_483_648 })],
  ])('AC-3 rejects %s selection artifacts without inserting an event', async (_description, selectionToken) => {
    const organizerId = await organizer(); const before = await eventCount();
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ selectionToken })).expect(400).expect(invalidToken);
    await expect(eventCount()).resolves.toBe(before);
  });

  it('AC-3 rejects a valid organizer JWT whose subject is not stored before body, artifact, or header validation', async () => {
    const before = await eventCount();
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(randomUUID())).set('Idempotency-Key', 'not-a-uuid')
      .send(body({ selectionToken: 'not-a-token', startsAt: '2030-01-01T00:00:00Z', venueName: '   ', auditoriumName: '   ' })).expect(401).expect(unauthorized);
    await expect(eventCount()).resolves.toBe(before);
  });

  it('AC-3 persists a required RESTRICT organizer foreign key', async () => {
    const organizerId = await organizer();
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body()).expect(201);
    await expect(prisma.user.delete({ where: { id: organizerId } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('AC-4 races initial same-key creates and returns the original byte-equivalent DTO', async () => {
    const organizerId = await organizer(); const retryKey = randomUUID(); const firstBody = body();
    const reissued = signedSelection({ issuedAt: Math.floor(now.getTime() / 1000) - 1, expiresAt: Math.floor(now.getTime() / 1000) + 1799 });
    const [first, simultaneous] = await Promise.all([
      request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(firstBody),
      request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(body({ selectionToken: reissued })),
    ]);
    expect(first.status).toBe(201); expect(simultaneous.status).toBe(201);
    expect(JSON.stringify(simultaneous.body)).toBe(JSON.stringify(first.body));
    const sequential = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(body({ selectionToken: reissued })).expect(201);
    expect(JSON.stringify(sequential.body)).toBe(JSON.stringify(first.body));
    const events = prisma as unknown as { event: { count(input: unknown): Promise<number> } };
    await expect(events.event.count({ where: { organizerId, idempotencyKey: retryKey } })).resolves.toBe(1);
  });

  it('AC-4 treats every canonical verified content field as effective and preserves the original row on conflict', async () => {
    const organizerId = await organizer(); const retryKey = randomUUID(); const original = body();
    const created = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(original).expect(201);
    const events = prisma as unknown as { event: { findUniqueOrThrow(input: unknown): Promise<Record<string, unknown>> } };
    const stored = await events.event.findUniqueOrThrow({ where: { id: created.body.id } });
    const changes: Partial<SelectionContent>[] = [
      { title: 'Different title' }, { releaseDate: null }, { posterPath: null }, { backdropPath: null }, { overview: 'Different overview' },
      { runtimeMinutes: 119 }, { genres: ['Thriller', 'Drama'] }, { originalLanguage: 'pt' },
    ];
    for (const change of changes) {
      await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey)
        .send(body({ selectionToken: signedSelection(change) })).expect(409).expect(idempotencyConflict);
    }
    await expect(events.event.findUniqueOrThrow({ where: { id: created.body.id } })).resolves.toEqual(stored);
  });

  it('AC-4 returns the original DTO for sequential same-effective retries', async () => {
    const organizerId = await organizer(); const retryKey = randomUUID(); const firstBody = body();
    const first = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(firstBody).expect(201);
    const reissued = signedSelection({ issuedAt: Math.floor(now.getTime() / 1000) - 1, expiresAt: Math.floor(now.getTime() / 1000) + 1799 });
    const [sequential, concurrent] = await Promise.all([
      request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(body({ selectionToken: reissued })),
      request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(body()),
    ]);
    expect(sequential.status).toBe(201); expect(concurrent.status).toBe(201);
    expect(JSON.stringify(sequential.body)).toBe(JSON.stringify(first.body));
    expect(JSON.stringify(concurrent.body)).toBe(JSON.stringify(first.body));
    const events = prisma as unknown as { event: { count(input: unknown): Promise<number> } };
    await expect(events.event.count({ where: { organizerId, idempotencyKey: retryKey } })).resolves.toBe(1);
  });

  it('AC-4 gives different effective reuse precedence over auditorium availability and scopes keys by organizer', async () => {
    const firstOrganizer = await organizer(); const secondOrganizer = await organizer(); const retryKey = randomUUID();
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(firstOrganizer)).set('Idempotency-Key', retryKey).send(body()).expect(201);
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(firstOrganizer)).set('Idempotency-Key', retryKey).send(body({ venueName: 'Different venue' })).expect(409).expect(idempotencyConflict);
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(secondOrganizer)).set('Idempotency-Key', retryKey).send(body({ venueName: 'Different venue' })).expect(201);
  });

  it.each([
    ['provider movie ID', (requestBody: ReturnType<typeof body>) => ({ ...requestBody, providerMovieId: 551, selectionToken: signedSelection({ providerMovieId: 551, title: 'Different movie' }) })],
    ['verified content', (requestBody: ReturnType<typeof body>) => ({ ...requestBody, selectionToken: signedSelection({ title: 'Different title' }) })],
    ['UTC start instant', (requestBody: ReturnType<typeof body>) => ({ ...requestBody, startsAt: '2030-01-04T20:00:00-03:00' })],
    ['auditorium equality key', (requestBody: ReturnType<typeof body>) => ({ ...requestBody, auditoriumName: 'Sala 2' })],
  ])('AC-4 rejects reuse when the %s differs', async (_description, alter) => {
    const organizerId = await organizer(); const retryKey = randomUUID(); const original = body();
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(original).expect(201);
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', retryKey).send(alter(original)).expect(409).expect(idempotencyConflict);
  });

  it('AC-5 enforces normalized half-open auditorium occupancy across statuses and concurrent creates', async () => {
    const organizerId = await organizer();
    const created = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body()).expect(201);
    const events = prisma as unknown as { event: { update(input: unknown): Promise<unknown>; count(input?: unknown): Promise<number> } };
    await events.event.update({ where: { id: created.body.id }, data: { status: 'PUBLISHED' } });
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ venueName: ' cinema\u00a0elite ', auditoriumName: 'SALA 1', providerMovieId: 550 })).expect(409).expect(unavailable);
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ providerMovieId: 551, selectionToken: signedSelection({ providerMovieId: 551, title: 'A different film' }) })).expect(409).expect(unavailable);
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ startsAt: '2030-01-03T01:15:00.000Z' })).expect(201);
    await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ venueName: 'Other Cinema' })).expect(201);
    const beforeConcurrent = await events.event.count();
    const first = request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ startsAt: '2030-01-05T20:00:00-03:00' }));
    const second = request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send(body({ startsAt: '2030-01-05T20:01:00-03:00' }));
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(outcomes.find(({ status }) => status === 409)?.body).toEqual(unavailable);
    await expect(events.event.count()).resolves.toBe(beforeConcurrent + 1);
  });

  it('AC-5 installs btree_gist and the named all-status GiST occupancy constraint', async () => {
    const rows = await prisma.$queryRaw<Array<{ conname: string; definition: string }>>`
      SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'Event_auditorium_occupancy_excl'
    `;
    expect(rows).toEqual([{ conname: 'Event_auditorium_occupancy_excl', definition: expect.stringContaining('EXCLUDE') }]);
    const definition = rows[0]?.definition ?? '';
    expect(definition).toMatch(/"venueKey" WITH =/);
    expect(definition).toMatch(/"auditoriumKey" WITH =/);
    expect(definition).toMatch(/tstzrange\("startsAt", "occupiedUntil", '\[\)'::text\) WITH &&/);
    expect(definition).not.toMatch(/\sWHERE\s/i);
    await expect(prisma.$queryRaw<Array<{ extname: string }>>`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`).resolves.toEqual([{ extname: 'btree_gist' }]);
  });
});
