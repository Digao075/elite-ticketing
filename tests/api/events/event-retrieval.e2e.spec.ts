import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { CONTENT_SELECTION_CLOCK, ContentSelectionTokenService } from '../../../apps/api/src/catalog/content-selection-token.service';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';
import { EVENTS_CLOCK } from '../../../apps/api/src/events/events.service';
import { TMDB_FETCH, type TmdbFetch } from '../../../apps/api/src/catalog/tmdb-catalog.service';

const authSecret = 'event-retrieval-auth-secret';
const selectionSecret = 'event-retrieval-selection-secret';
const now = new Date('2030-01-01T00:00:00.000Z');
const unauthorized = { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired access token' };
const forbidden = { statusCode: 403, error: 'Forbidden', message: 'Insufficient role' };
const invalidId = { statusCode: 400, error: 'Bad Request', message: 'eventId must be a UUID' };
const notFound = { statusCode: 404, error: 'Not Found', message: 'Event not found' };

const content = {
  providerMovieId: 550,
  title: 'Clube da Luta',
  releaseDate: null as string | null,
  posterPath: null as string | null,
  backdropPath: '/backdrop.jpg',
  overview: 'Um retrato da insônia.',
  runtimeMinutes: 120,
  genres: ['Drama', 'Thriller'],
  originalLanguage: 'en',
};

type Spy = { mockClear(): unknown; mockRestore(): unknown };
type NamedSpy = { name: string; spy: Spy };

function bearer(userId: string, role: Role = Role.ORGANIZER): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

function selectionToken(): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const encoded = Buffer.from(JSON.stringify({ ...content, version: 1, issuedAt, expiresAt: issuedAt + 1_800 })).toString('base64url');
  const signature = createHmac('sha256', selectionSecret).update(`elite-ticketing:content-selection:v1.${encoded}`, 'utf8').digest('base64url');
  return `v1.${encoded}.${signature}`;
}

function observeCatalogMethods(moduleRef: TestingModule): NamedSpy[] {
  type Wrapper = { instance?: unknown; metatype?: { name?: string } };
  type NestModule = { providers: Map<unknown, Wrapper> };
  const modules = (moduleRef as unknown as { container: { getModules(): Map<unknown, NestModule> } }).container.getModules();
  const observed: NamedSpy[] = [];
  for (const nestModule of modules.values()) for (const wrapper of nestModule.providers.values()) {
    const instance = wrapper.instance as Record<string, unknown> | undefined;
    const name = wrapper.metatype?.name ?? instance?.constructor?.name ?? '';
    if (!/^Tmdb.*Catalog.*Service$/i.test(name) || !instance) continue;
    for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
      if (method !== 'constructor' && typeof instance[method] === 'function') observed.push({ name: `${name}.${method}`, spy: vi.spyOn(instance as Record<string, () => unknown>, method) });
    }
  }
  return observed;
}

function observeEventMethods(prisma: PrismaService): NamedSpy[] {
  const event = (prisma as unknown as { event: Record<string, unknown> }).event;
  const observed: NamedSpy[] = [];
  for (const method of new Set([...Object.keys(event), ...Object.getOwnPropertyNames(Object.getPrototypeOf(event))])) {
    if (method !== 'constructor' && typeof event[method] === 'function') {
      observed.push({ name: `event.${method}`, spy: vi.spyOn(event as Record<string, () => unknown>, method) });
    }
  }
  return observed;
}

describe('GET /events/:eventId', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tmdbFetch: ReturnType<typeof vi.fn<TmdbFetch>>;
  let catalogSpies: NamedSpy[];
  let selectionSpies: NamedSpy[];
  let eventSpies: NamedSpy[];
  const userIds: string[] = [];
  const previousAuthSecret = process.env.AUTH_JWT_SECRET;
  const previousSelectionSecret = process.env.CONTENT_SELECTION_SECRET;
  const previousTmdbApiKey = process.env.TMDB_API_KEY;

  async function user(role: Role = Role.ORGANIZER): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({ data: { id, email: `${id}@example.test`, passwordHash: 'opaque', role } });
    return id;
  }

  async function organizer(): Promise<string> { return user(); }

  async function createEvent(organizerId: string): Promise<Record<string, unknown>> {
    tmdbFetch.mockClear();
    catalogSpies.forEach(({ spy }) => spy.mockClear());
    return (await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID())
      .send({ providerMovieId: content.providerMovieId, selectionToken: selectionToken(), startsAt: '2030-01-02T20:00:00-03:00', venueName: `Cinema Elite ${organizerId}`, auditoriumName: 'Sala 1' }).expect(201)).body;
  }

  function clearRetrievalSpies() {
    tmdbFetch.mockClear();
    catalogSpies.forEach(({ spy }) => spy.mockClear());
    selectionSpies.forEach(({ spy }) => spy.mockClear());
    eventSpies.forEach(({ spy }) => spy.mockClear());
  }

  function expectNoCatalogOrTmdbCalls() {
    expect(tmdbFetch).not.toHaveBeenCalled();
    for (const { name, spy } of catalogSpies) expect(spy, name).not.toHaveBeenCalled();
    for (const { name, spy } of selectionSpies) expect(spy, name).not.toHaveBeenCalled();
  }

  function expectNoEventLookup() {
    for (const { name, spy } of eventSpies) expect(spy, name).not.toHaveBeenCalled();
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
    catalogSpies = observeCatalogMethods(moduleRef);
    const selectionService = moduleRef.get(ContentSelectionTokenService) as unknown as Record<string, () => unknown>;
    selectionSpies = ['issue', 'verify'].map((method) => ({
      name: `ContentSelectionTokenService.${method}`,
      spy: vi.spyOn(selectionService, method),
    }));
    eventSpies = observeEventMethods(prisma);
    expect(catalogSpies).not.toEqual([]);
    expect(selectionSpies).toHaveLength(2);
    expect(eventSpies).not.toEqual([]);
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
      eventSpies?.forEach(({ spy }) => spy.mockRestore());
      selectionSpies?.forEach(({ spy }) => spy.mockRestore());
      catalogSpies?.forEach(({ spy }) => spy.mockRestore());
      await app?.close(); await moduleRef?.close();
      if (previousAuthSecret === undefined) delete process.env.AUTH_JWT_SECRET; else process.env.AUTH_JWT_SECRET = previousAuthSecret;
      if (previousSelectionSecret === undefined) delete process.env.CONTENT_SELECTION_SECRET; else process.env.CONTENT_SELECTION_SECRET = previousSelectionSecret;
      if (previousTmdbApiKey === undefined) delete process.env.TMDB_API_KEY; else process.env.TMDB_API_KEY = previousTmdbApiKey;
    }
  });

  it('AC-1 returns the exact owned DRAFT DTO with its persisted nullable snapshot and no internal keys', async () => {
    const organizerId = await organizer();
    const created = await createEvent(organizerId);
    const events = prisma as unknown as { event: { findUniqueOrThrow(input: unknown): Promise<{ createdAt: Date; updatedAt: Date }> } };
    const stored = await events.event.findUniqueOrThrow({ where: { id: created.id } });
    clearRetrievalSpies();
    const response = await request(app.getHttpServer()).get(`/events/${created.id}`).set('Authorization', bearer(organizerId)).expect(200);
    expect(response.body).toEqual({
      id: created.id, status: 'DRAFT', organizerId, startsAt: '2030-01-02T23:00:00.000Z', venueName: `Cinema Elite ${organizerId}`, auditoriumName: 'Sala 1', content,
      createdAt: stored.createdAt.toISOString(), updatedAt: stored.updatedAt.toISOString(),
    });
    expect(Object.keys(response.body).sort()).toEqual(['auditoriumName', 'content', 'createdAt', 'id', 'organizerId', 'startsAt', 'status', 'updatedAt', 'venueName']);
    expect(response.body).not.toHaveProperty('movieEndsAt');
    expect(response.body).not.toHaveProperty('occupiedUntil');
    expectNoCatalogOrTmdbCalls();
  });

  it('AC-2 returns an owned PUBLISHED snapshot without using changed or unavailable catalog/TMDB fixtures', async () => {
    const organizerId = await organizer();
    const created = await createEvent(organizerId);
    const events = prisma as unknown as { event: { update(input: unknown): Promise<{ updatedAt: Date }> } };
    const published = await events.event.update({ where: { id: created.id }, data: { status: 'PUBLISHED' } });
    const originalContent = { ...content, genres: [...content.genres] };
    try {
      Object.assign(content, {
        providerMovieId: 999, title: 'Changed provider title', releaseDate: '1999-12-31', posterPath: '/changed-poster.jpg',
        backdropPath: '/changed-backdrop.jpg', overview: 'Changed provider overview.', runtimeMinutes: 1,
        genres: ['Changed'], originalLanguage: 'pt',
      });
      tmdbFetch.mockImplementation(() => { throw new Error('TMDB must not be called during retrieval'); });
      clearRetrievalSpies();
      const response = await request(app.getHttpServer()).get(`/events/${created.id}`).set('Authorization', bearer(organizerId)).expect(200);
      expect(response.body).toEqual({ ...created, status: 'PUBLISHED', updatedAt: published.updatedAt.toISOString() });
      expectNoCatalogOrTmdbCalls();
    } finally {
      Object.assign(content, originalContent);
    }
  });

  it.each([
    ['non-UUID', 'not-a-uuid'], ['missing hyphens', '11111111111141118111111111111111'], ['version 0', '11111111-1111-0111-8111-111111111111'],
    ['version 6', '11111111-1111-6111-8111-111111111111'], ['variant 7', '11111111-1111-4111-7111-111111111111'],
  ])('AC-3 rejects %s before event lookup or catalog/TMDB access', async (_description, eventId) => {
    const organizerId = await organizer();
    clearRetrievalSpies();
    await request(app.getHttpServer()).get(`/events/${eventId}`).set('Authorization', bearer(organizerId)).expect(400).expect(invalidId);
    expectNoEventLookup(); expectNoCatalogOrTmdbCalls();
  });

  it('AC-4 gives the identical 404 for absent and other-owner events without revealing data or invoking catalog/TMDB', async () => {
    const owner = await organizer(); const otherOrganizer = await organizer();
    const created = await createEvent(owner);
    clearRetrievalSpies();
    await request(app.getHttpServer()).get(`/events/${created.id}`).set('Authorization', bearer(owner)).expect(200);
    clearRetrievalSpies();
    const absent = await request(app.getHttpServer()).get('/events/11111111-1111-4111-8111-111111111111').set('Authorization', bearer(owner)).expect(404).expect(notFound);
    const other = await request(app.getHttpServer()).get(`/events/${created.id}`).set('Authorization', bearer(otherOrganizer)).expect(404).expect(notFound);
    expect(other.body).toEqual(absent.body);
    expect(JSON.stringify(other.body)).not.toContain(created.id as string);
    expect(JSON.stringify(other.body)).not.toContain(owner);
    expectNoCatalogOrTmdbCalls();
  });

  it.each([
    ['missing bearer authentication', undefined], ['invalid bearer authentication', 'Bearer invalid'],
    ['signed organizer token for no stored user', bearer(randomUUID())],
  ])('AC-5 denies %s before UUID validation, event lookup, or catalog/TMDB access', async (_description, authorization) => {
    const call = request(app.getHttpServer()).get('/events/not-a-uuid');
    if (authorization) call.set('Authorization', authorization);
    clearRetrievalSpies();
    await call.expect(unauthorized.statusCode).expect(unauthorized);
    expectNoEventLookup(); expectNoCatalogOrTmdbCalls();
  });

  it.each([Role.CUSTOMER, Role.GATE])('AC-5 denies a stored %s user before UUID validation, event lookup, or catalog/TMDB access', async (role) => {
    const userId = await user(role);
    clearRetrievalSpies();
    await request(app.getHttpServer()).get('/events/not-a-uuid').set('Authorization', bearer(userId, role)).expect(forbidden.statusCode).expect(forbidden);
    expectNoEventLookup(); expectNoCatalogOrTmdbCalls();
  });

  it.each([Role.CUSTOMER, Role.GATE])('AC-5 denies a signed %s token with no stored subject before UUID validation, event lookup, or provider access', async (role) => {
    clearRetrievalSpies();
    await request(app.getHttpServer()).get('/events/not-a-uuid').set('Authorization', bearer(randomUUID(), role)).expect(unauthorized.statusCode).expect(unauthorized);
    expectNoEventLookup(); expectNoCatalogOrTmdbCalls();
  });
});
