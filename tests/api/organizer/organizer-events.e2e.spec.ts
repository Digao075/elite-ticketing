import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';

const authSecret = 'organizer-events-auth-secret';

function bearer(userId: string, role: Role): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

describe('GET /organizer/events', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());

  async function user(role: Role): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({ data: { id, email: `${id}@example.test`, passwordHash: 'opaque', role } });
    return id;
  }

  async function event(organizerId: string, options: { status?: 'DRAFT' | 'PUBLISHED'; priceCents?: number | null; startsAt?: string; seatCount?: number }) {
    const { status = 'DRAFT', priceCents = null, startsAt = '2030-02-01T23:00:00.000Z', seatCount = 0 } = options;
    const created = await prisma.event.create({
      data: {
        organizerId,
        idempotencyKey: randomUUID(),
        status,
        priceCents,
        startsAt: new Date(startsAt),
        movieEndsAt: new Date(new Date(startsAt).getTime() + 7_200_000),
        occupiedUntil: new Date(new Date(startsAt).getTime() + 9_000_000),
        venueName: 'Cine Elite',
        auditoriumName: `Sala ${randomUUID()}`,
        venueKey: `cine-${randomUUID()}`,
        auditoriumKey: `sala-${randomUUID()}`,
        contentProviderMovieId: 550,
        contentTitle: 'Clube da Luta',
        contentReleaseDate: null,
        contentPosterPath: '/poster.jpg',
        contentBackdropPath: null,
        contentOverview: 'Resumo.',
        contentRuntimeMinutes: 120,
        contentGenres: ['Drama'],
        contentOriginalLanguage: 'en',
      },
    });
    for (let number = 1; number <= seatCount; number += 1) {
      await prisma.eventSeat.create({ data: { eventId: created.id, seatLabel: `A${number}`, rowLabel: 'A', seatNumber: number } });
    }
    return created.id;
  }

  /** Sells one seat outright and puts a live hold on another. */
  async function occupy(eventId: string, customerId: string, soldLabel: string, heldLabel: string) {
    const reservation = await prisma.reservation.create({
      data: { eventId, customerId, status: 'PAID', expiresAt: new Date('2030-01-01T00:10:00.000Z') },
    });
    const sold = await prisma.eventSeat.findFirstOrThrow({ where: { eventId, seatLabel: soldLabel } });
    await prisma.seatAllocation.create({ data: { eventSeatId: sold.id, reservationId: reservation.id } });
    await prisma.ticket.create({ data: { reservationId: reservation.id, eventSeatId: sold.id, shareToken: randomUUID() } });

    const held = await prisma.eventSeat.findFirstOrThrow({ where: { eventId, seatLabel: heldLabel } });
    const hold = await prisma.reservation.create({
      data: { eventId, customerId, status: 'PENDING', expiresAt: new Date('2030-01-01T00:10:00.000Z') },
    });
    await prisma.seatAllocation.create({ data: { eventSeatId: held.id, reservationId: hold.id } });
  }

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = authSecret;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.reservation.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.event.deleteMany({ where: { organizerId: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.event.deleteMany({ where: { organizerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await moduleRef?.close();
  });

  it('AC-1 returns only the caller events, newest session first, drafts included', async () => {
    const owner = await user(Role.ORGANIZER);
    const other = await user(Role.ORGANIZER);
    const later = await event(owner, { status: 'PUBLISHED', priceCents: 3500, seatCount: 3, startsAt: '2030-03-01T23:00:00.000Z' });
    const earlier = await event(owner, { status: 'DRAFT', startsAt: '2030-02-01T23:00:00.000Z' });
    await event(other, { status: 'PUBLISHED', priceCents: 9900, seatCount: 2 });

    const response = await http().get('/organizer/events').set('Authorization', bearer(owner, Role.ORGANIZER)).expect(200);

    expect(response.body.map((entry: { id: string }) => entry.id)).toEqual([later, earlier]);
    expect(response.body).toHaveLength(2);
  });

  it('AC-2 reports capacity, sold and remaining seats from live allocations', async () => {
    const owner = await user(Role.ORGANIZER);
    const customer = await user(Role.CUSTOMER);
    const eventId = await event(owner, { status: 'PUBLISHED', priceCents: 3500, seatCount: 4 });
    await occupy(eventId, customer, 'A1', 'A2');

    const response = await http().get('/organizer/events').set('Authorization', bearer(owner, Role.ORGANIZER)).expect(200);

    expect(response.body[0]).toMatchObject({
      id: eventId,
      status: 'PUBLISHED',
      priceCents: 3500,
      capacity: 4,
      ticketsSold: 1,
      // One sold and one still held, so two of the four remain sellable.
      remainingSeats: 2,
      revenueCents: 3500,
    });
    expect(response.body[0].content).toMatchObject({ title: 'Clube da Luta', posterPath: '/poster.jpg' });
  });

  it('AC-3 describes an unconfigured draft without inventing numbers', async () => {
    const owner = await user(Role.ORGANIZER);
    const eventId = await event(owner, { status: 'DRAFT' });

    const response = await http().get('/organizer/events').set('Authorization', bearer(owner, Role.ORGANIZER)).expect(200);

    expect(response.body[0]).toMatchObject({
      id: eventId, status: 'DRAFT', priceCents: null, capacity: 0, ticketsSold: 0, remainingSeats: 0, revenueCents: 0,
    });
    expect(response.body[0].readyToPublish).toBe(false);
  });

  it('AC-4 marks a priced, seated draft as ready to publish', async () => {
    const owner = await user(Role.ORGANIZER);
    await event(owner, { status: 'DRAFT', priceCents: 4200, seatCount: 2 });

    const response = await http().get('/organizer/events').set('Authorization', bearer(owner, Role.ORGANIZER)).expect(200);

    expect(response.body[0]).toMatchObject({ status: 'DRAFT', readyToPublish: true });
  });

  it('AC-5 returns an empty list rather than an error for a new organizer', async () => {
    const owner = await user(Role.ORGANIZER);

    const response = await http().get('/organizer/events').set('Authorization', bearer(owner, Role.ORGANIZER)).expect(200);

    expect(response.body).toEqual([]);
  });

  it('AC-6 refuses other roles and unauthenticated callers, and leaks no internals', async () => {
    const owner = await user(Role.ORGANIZER);
    await event(owner, { status: 'PUBLISHED', priceCents: 3500, seatCount: 1 });

    await http().get('/organizer/events').expect(401);
    await http().get('/organizer/events').set('Authorization', 'Bearer nonsense').expect(401);
    await http().get('/organizer/events').set('Authorization', bearer(randomUUID(), Role.ORGANIZER)).expect(401);
    await http().get('/organizer/events').set('Authorization', bearer(await user(Role.CUSTOMER), Role.CUSTOMER)).expect(403);
    await http().get('/organizer/events').set('Authorization', bearer(await user(Role.GATE), Role.GATE)).expect(403);

    const response = await http().get('/organizer/events').set('Authorization', bearer(owner, Role.ORGANIZER)).expect(200);
    expect(JSON.stringify(response.body)).not.toContain('idempotencyKey');
    expect(JSON.stringify(response.body)).not.toContain('occupiedUntil');
  });
});
