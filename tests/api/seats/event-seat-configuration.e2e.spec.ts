import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { CONTENT_SELECTION_CLOCK } from '../../../apps/api/src/catalog/content-selection-token.service';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';
import { EVENTS_CLOCK } from '../../../apps/api/src/events/events.service';

const authSecret = 'event-seat-configuration-auth-secret';
const selectionSecret = 'event-seat-configuration-selection-secret';
const now = new Date('2030-01-01T00:00:00.000Z');
const unauthorized = { statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired access token' };
const forbidden = { statusCode: 403, error: 'Forbidden', message: 'Insufficient role' };
const invalidId = { statusCode: 400, error: 'Bad Request', message: 'eventId must be a UUID' };
const notFound = { statusCode: 404, error: 'Not Found', message: 'Event not found' };
const published = { statusCode: 409, error: 'Conflict', message: 'Published event seating cannot be changed' };

type StoredSeat = { id: string; seatLabel: string; rowLabel: string; seatNumber: number };
type StoredEvent = { id: string; priceCents: number | null; updatedAt: Date; status: string };
type PrismaAccess = {
  event: {
    deleteMany(input: unknown): Promise<unknown>;
    findUniqueOrThrow(input: unknown): Promise<StoredEvent>;
    update(input: unknown): Promise<unknown>;
  };
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

function bearer(userId: string, role: Role = Role.ORGANIZER): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

function selectionToken(): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const content = {
    providerMovieId: 550, title: 'Clube da Luta', releaseDate: null, posterPath: null, backdropPath: '/backdrop.jpg',
    overview: 'Um retrato da insônia.', runtimeMinutes: 120, genres: ['Drama', 'Thriller'], originalLanguage: 'en',
    version: 1, issuedAt, expiresAt: issuedAt + 1_800,
  };
  const encoded = Buffer.from(JSON.stringify(content)).toString('base64url');
  const signature = createHmac('sha256', selectionSecret).update(`elite-ticketing:content-selection:v1.${encoded}`, 'utf8').digest('base64url');
  return `v1.${encoded}.${signature}`;
}

function configuration(priceCents = 3500, rows: Array<{ label: string; seatCount: number }> = [{ label: 'B', seatCount: 2 }, { label: 'A', seatCount: 3 }]) {
  return { priceCents, rows };
}

describe('PUT /events/:eventId/seats', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const previousAuthSecret = process.env.AUTH_JWT_SECRET;
  const previousSelectionSecret = process.env.CONTENT_SELECTION_SECRET;

  const db = () => prisma as unknown as PrismaAccess;

  async function user(role: Role = Role.ORGANIZER): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({ data: { id, email: `${id}@example.test`, passwordHash: 'opaque', role } });
    return id;
  }

  async function event(organizerId: string, auditoriumName = 'Sala 1'): Promise<string> {
    const response = await request(app.getHttpServer()).post('/events').set('Authorization', bearer(organizerId)).set('Idempotency-Key', randomUUID()).send({
      providerMovieId: 550, selectionToken: selectionToken(), startsAt: '2030-01-02T20:00:00-03:00', venueName: `Cinema ${organizerId}`, auditoriumName,
    }).expect(201);
    return response.body.id as string;
  }

  async function seats(eventId: string): Promise<StoredSeat[]> {
    return db().$queryRawUnsafe<StoredSeat[]>(
      'SELECT "id", "seatLabel", "rowLabel", "seatNumber" FROM "EventSeat" WHERE "eventId" = $1::uuid ORDER BY "rowLabel", "seatNumber"', eventId,
    );
  }

  async function snapshot(eventId: string) {
    const stored = await db().event.findUniqueOrThrow({ where: { id: eventId } });
    return { priceCents: stored.priceCents, updatedAt: stored.updatedAt.toISOString(), seats: await seats(eventId) };
  }

  function put(eventId: string, organizerId: string, body: unknown) {
    return request(app.getHttpServer()).put(`/events/${eventId}/seats`).set('Authorization', bearer(organizerId)).send(body);
  }

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = authSecret;
    process.env.CONTENT_SELECTION_SECRET = selectionSecret;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONTENT_SELECTION_CLOCK).useValue(() => now)
      .overrideProvider(EVENTS_CLOCK).useValue(() => now)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await db().event.deleteMany({ where: { organizerId: { in: userIds } } });
  });

  afterAll(async () => {
    try {
      await db().event.deleteMany({ where: { organizerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app?.close(); await moduleRef?.close();
      if (previousAuthSecret === undefined) delete process.env.AUTH_JWT_SECRET; else process.env.AUTH_JWT_SECRET = previousAuthSecret;
      if (previousSelectionSecret === undefined) delete process.env.CONTENT_SELECTION_SECRET; else process.env.CONTENT_SELECTION_SECRET = previousSelectionSecret;
    }
  });

  it('AC-1 stores exactly the canonical inventory, price, and PostgreSQL uniqueness constraint', async () => {
    const organizerId = await user(); const eventId = await event(organizerId);
    const response = await put(eventId, organizerId, configuration()).expect(200);
    expect(response.body).toEqual({
      eventId, currency: 'BRL', priceCents: 3500, capacity: 5,
      seats: [
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), seatLabel: 'A1', rowLabel: 'A', seatNumber: 1 },
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), seatLabel: 'A2', rowLabel: 'A', seatNumber: 2 },
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), seatLabel: 'A3', rowLabel: 'A', seatNumber: 3 },
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), seatLabel: 'B1', rowLabel: 'B', seatNumber: 1 },
        { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), seatLabel: 'B2', rowLabel: 'B', seatNumber: 2 },
      ],
    });
    expect(Object.keys(response.body).sort()).toEqual(['capacity', 'currency', 'eventId', 'priceCents', 'seats']);
    expect(await snapshot(eventId)).toMatchObject({ priceCents: 3500, seats: response.body.seats });
    await expect(db().$executeRawUnsafe(
      'INSERT INTO "EventSeat" ("id", "eventId", "seatLabel", "rowLabel", "seatNumber") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', randomUUID(), eventId, 'A1', 'A', 1,
    )).rejects.toMatchObject({ code: 'P2010', meta: expect.objectContaining({ code: '23505' }) });
    expect(await db().$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'EventSeat' AND indexname = 'EventSeat_eventId_seatLabel_key'`,
    )).toHaveLength(1);
    const other = await event(organizerId, 'Sala 2');
    await expect(db().$executeRawUnsafe(
      'INSERT INTO "EventSeat" ("id", "eventId", "seatLabel", "rowLabel", "seatNumber") VALUES ($1::uuid, $2::uuid, $3, $4, $5)', randomUUID(), other, 'A1', 'A', 1,
    )).resolves.toBe(1);
  });

  it('AC-2 makes an identical request byte-equivalent and preserves IDs, price, and timestamp', async () => {
    const organizerId = await user(); const eventId = await event(organizerId);
    const first = await put(eventId, organizerId, configuration()).expect(200); const before = await snapshot(eventId);
    const second = await put(eventId, organizerId, configuration()).expect(200); const after = await snapshot(eventId);
    expect(second.body).toEqual(first.body); expect(after).toEqual(before);
  });

  it('AC-3 atomically replaces changed layouts and serializes concurrent complete replacements', async () => {
    const organizerId = await user(); const eventId = await event(organizerId);
    const initial = await put(eventId, organizerId, configuration()).expect(200);
    const changed = configuration(4200, [{ label: 'C', seatCount: 2 }, { label: 'A', seatCount: 1 }]);
    const changedResponse = await put(eventId, organizerId, changed).expect(200);
    expect(changedResponse.body).toMatchObject({ eventId, currency: 'BRL', priceCents: 4200, capacity: 3, seats: [
      { seatLabel: 'A1', rowLabel: 'A', seatNumber: 1 }, { seatLabel: 'C1', rowLabel: 'C', seatNumber: 1 }, { seatLabel: 'C2', rowLabel: 'C', seatNumber: 2 },
    ] });
    expect((await seats(eventId)).map(({ seatLabel }) => seatLabel)).toEqual(['A1', 'C1', 'C2']);
    expect(initial.body.seats.map(({ id }: StoredSeat) => id)).not.toEqual(changedResponse.body.seats.map(({ id }: StoredSeat) => id));
    const first = configuration(5100, [{ label: 'D', seatCount: 2 }]); const second = configuration(6200, [{ label: 'E', seatCount: 3 }]);
    const [one, two] = await Promise.all([put(eventId, organizerId, first), put(eventId, organizerId, second)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    for (const response of [one, two]) expect(response.body).toMatchObject({ eventId, currency: 'BRL', priceCents: expect.any(Number), capacity: expect.any(Number) });
    const final = await snapshot(eventId);
    expect([{ priceCents: 5100, labels: ['D1', 'D2'] }, { priceCents: 6200, labels: ['E1', 'E2', 'E3'] }]).toContainEqual({
      priceCents: final.priceCents, labels: final.seats.map(({ seatLabel }) => seatLabel),
    });
  });

  it.each([
    ['non-object body', [], 'request body must be a JSON object'],
    ['unknown top-level property', { ...configuration(), extra: true }, 'property extra should not exist'],
    ['missing price', { rows: configuration().rows }, 'priceCents must be an integer from 100 to 1000000'],
    ['low price', configuration(99), 'priceCents must be an integer from 100 to 1000000'],
    ['high price', configuration(1_000_001), 'priceCents must be an integer from 100 to 1000000'],
    ['fractional price', configuration(100.5), 'priceCents must be an integer from 100 to 1000000'],
    ['zero rows', configuration(100, []), 'rows must contain 1 to 26 entries'],
    ['27 rows', configuration(100, Array.from({ length: 27 }, (_, index) => ({ label: String.fromCharCode(65 + index), seatCount: 1 }))), 'rows must contain 1 to 26 entries'],
    ['non-object row', configuration(100, [null as unknown as { label: string; seatCount: number }]), 'rows[0] must be a JSON object'],
    ['unknown row field', configuration(100, [{ label: 'A', seatCount: 1, extra: true } as unknown as { label: string; seatCount: number }]), 'property rows[0].extra should not exist'],
    ['lowercase label', configuration(100, [{ label: 'a', seatCount: 1 }]), 'rows[0].label must be one uppercase letter A-Z'],
    ['multi-character label', configuration(100, [{ label: 'AA', seatCount: 1 }]), 'rows[0].label must be one uppercase letter A-Z'],
    ['non-letter label', configuration(100, [{ label: '1', seatCount: 1 }]), 'rows[0].label must be one uppercase letter A-Z'],
    ['zero seats', configuration(100, [{ label: 'A', seatCount: 0 }]), 'rows[0].seatCount must be an integer from 1 to 50'],
    ['51 seats', configuration(100, [{ label: 'A', seatCount: 51 }]), 'rows[0].seatCount must be an integer from 1 to 50'],
    ['fractional seats', configuration(100, [{ label: 'A', seatCount: 1.5 }]), 'rows[0].seatCount must be an integer from 1 to 50'],
    ['duplicate labels', configuration(100, [{ label: 'A', seatCount: 1 }, { label: 'A', seatCount: 1 }]), 'rows labels must be unique'],
    ['501 total seats', configuration(100, Array.from({ length: 11 }, (_, index) => ({ label: String.fromCharCode(65 + index), seatCount: index === 10 ? 1 : 50 }))), 'rows must define at most 500 seats'],
  ])('AC-4 returns the exact validation error for %s without changing inventory', async (_description, body, message) => {
    const organizerId = await user(); const eventId = await event(organizerId);
    await put(eventId, organizerId, configuration()).expect(200); const before = await snapshot(eventId);
    await put(eventId, organizerId, body).expect(400).expect({ statusCode: 400, error: 'Bad Request', message });
    expect(await snapshot(eventId)).toEqual(before);
  });

  it('AC-4 accepts every inclusive price, row, and capacity boundary', async () => {
    const organizerId = await user(); const eventId = await event(organizerId);
    for (const body of [
      configuration(100, [{ label: 'A', seatCount: 1 }]), configuration(1_000_000, [{ label: 'A', seatCount: 50 }]),
      configuration(100, Array.from({ length: 26 }, (_, index) => ({ label: String.fromCharCode(65 + index), seatCount: 1 }))),
      configuration(100, Array.from({ length: 10 }, (_, index) => ({ label: String.fromCharCode(65 + index), seatCount: 50 }))),
    ]) await put(eventId, organizerId, body).expect(200).expect(({ body: response }) => expect(response.capacity).toBe(body.rows.reduce((sum, row) => sum + row.seatCount, 0)));
  });

  it.each([
    ['missing token', undefined, 'not-a-uuid', configuration(), unauthorized],
    ['invalid token', 'Bearer invalid', 'not-a-uuid', configuration(), unauthorized],
    ['unstored signed token', bearer(randomUUID()), 'not-a-uuid', configuration(), unauthorized],
  ])('AC-5 authenticates before path or body validation for %s', async (_description, authorization, eventId, body, expected) => {
    const call = request(app.getHttpServer()).put(`/events/${eventId}/seats`).send(body);
    if (authorization) call.set('Authorization', authorization);
    await call.expect(expected.statusCode).expect(expected);
  });

  it.each([Role.CUSTOMER, Role.GATE])('AC-5 forbids stored %s before path or body validation', async (role) => {
    const id = await user(role);
    await request(app.getHttpServer()).put('/events/not-a-uuid/seats').set('Authorization', bearer(id, role)).send([]).expect(403).expect(forbidden);
  });

  it('AC-5 rejects invalid IDs, hides absent/other-owner events, and leaves every denied configuration unchanged', async () => {
    const owner = await user(); const other = await user(); const eventId = await event(owner);
    await put(eventId, owner, configuration()).expect(200); const before = await snapshot(eventId);
    await put('11111111-1111-0111-8111-111111111111', owner, configuration()).expect(400).expect(invalidId);
    const absent = await put('11111111-1111-4111-8111-111111111111', owner, configuration()).expect(404).expect(notFound);
    const hidden = await put(eventId, other, configuration()).expect(404).expect(notFound);
    expect(hidden.body).toEqual(absent.body); expect(JSON.stringify(hidden.body)).not.toContain(eventId); expect(JSON.stringify(hidden.body)).not.toContain(owner);
    expect(await snapshot(eventId)).toEqual(before);
  });

  it('AC-5 rejects configuration changes for an owned published event without changing it', async () => {
    const organizerId = await user(); const eventId = await event(organizerId);
    await put(eventId, organizerId, configuration()).expect(200);
    await db().event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } }); const before = await snapshot(eventId);
    await put(eventId, organizerId, configuration(4200, [{ label: 'C', seatCount: 1 }])).expect(409).expect(published);
    expect(await snapshot(eventId)).toEqual(before);
  });
});
