import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { PrismaService } from '../../../apps/api/src/database/prisma.service';
import { RESERVATIONS_CLOCK } from '../../../apps/api/src/reservations/reservations.service';

const authSecret = 'sellable-journey-auth-secret';
const qrSecret = 'sellable-journey-qr-secret';

type Prisma = PrismaService & { $queryRawUnsafe<T>(q: string, ...v: unknown[]): Promise<T> };

function bearer(userId: string, role: Role): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const signature = createHmac('sha256', authSecret).update(`${header}.${payload}`).digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

describe('sellable journey', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: Prisma;
  let now = new Date('2030-01-01T00:00:00.000Z');
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());

  async function user(role: Role): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({ data: { id, email: `${id}@example.test`, passwordHash: 'opaque', role } });
    return id;
  }

  /** Creates a PUBLISHED event with `rows x seatsPerRow` seats, straight through the API. */
  async function publishedEvent(organizerId: string, rows = 1, seatsPerRow = 3, priceCents = 3500): Promise<string> {
    const event = await prisma.event.create({
      data: {
        organizerId,
        idempotencyKey: randomUUID(),
        startsAt: new Date('2030-02-01T23:00:00.000Z'),
        movieEndsAt: new Date('2030-02-02T01:00:00.000Z'),
        occupiedUntil: new Date('2030-02-02T01:30:00.000Z'),
        venueName: 'Cinema Teste',
        auditoriumName: `Sala ${randomUUID()}`,
        venueKey: `cinema-${randomUUID()}`,
        auditoriumKey: `sala-${randomUUID()}`,
        contentProviderMovieId: 550,
        contentTitle: 'Clube da Luta',
        contentReleaseDate: null,
        contentPosterPath: null,
        contentBackdropPath: null,
        contentOverview: 'Um retrato da insonia.',
        contentRuntimeMinutes: 120,
        contentGenres: ['Drama'],
        contentOriginalLanguage: 'en',
        priceCents,
      },
    });
    for (let row = 0; row < rows; row += 1) {
      for (let seat = 1; seat <= seatsPerRow; seat += 1) {
        await prisma.eventSeat.create({
          data: { eventId: event.id, seatLabel: `${String.fromCharCode(65 + row)}${seat}`, rowLabel: String.fromCharCode(65 + row), seatNumber: seat },
        });
      }
    }
    await prisma.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } });
    return event.id;
  }

  async function buyTicket(eventId: string, customerId: string, seatLabels: string[]) {
    const reservation = await http().post('/reservations').set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ eventId, seatLabels }).expect(201);
    await http().post(`/reservations/${reservation.body.id}/payment`).set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ outcome: 'approve' }).expect(201);
    const tickets = await http().get('/tickets/me').set('Authorization', bearer(customerId, Role.CUSTOMER)).expect(200);
    return tickets.body;
  }

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = authSecret;
    process.env.TICKET_QR_SECRET = qrSecret;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RESERVATIONS_CLOCK).useValue(() => now)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService) as Prisma;
  });

  beforeEach(async () => {
    now = new Date('2030-01-01T00:00:00.000Z');
    await prisma.event.deleteMany({ where: { organizerId: { in: userIds } } });
    await prisma.reservation.deleteMany({ where: { customerId: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { organizerId: { in: userIds } } });
    await prisma.reservation.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
    await moduleRef?.close();
  });

  it('AC-1 publishes only a priced, seated, owned draft and is idempotent', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const other = await user(Role.ORGANIZER);
    const eventId = await publishedEvent(organizerId);
    await prisma.event.update({ where: { id: eventId }, data: { status: 'DRAFT' } });

    const first = await http().post(`/events/${eventId}/publish`).set('Authorization', bearer(organizerId, Role.ORGANIZER)).expect(201);
    expect(first.body).toEqual({ id: eventId, status: 'PUBLISHED', priceCents: 3500, capacity: 3 });

    const again = await http().post(`/events/${eventId}/publish`).set('Authorization', bearer(organizerId, Role.ORGANIZER)).expect(201);
    expect(again.body).toEqual(first.body);

    await http().post(`/events/${eventId}/publish`).set('Authorization', bearer(other, Role.ORGANIZER)).expect(404);
    await http().post(`/events/${eventId}/publish`).set('Authorization', bearer(await user(Role.CUSTOMER), Role.CUSTOMER)).expect(403);

    const unpriced = await publishedEvent(organizerId);
    await prisma.event.update({ where: { id: unpriced }, data: { status: 'DRAFT', priceCents: null } });
    await http().post(`/events/${unpriced}/publish`).set('Authorization', bearer(organizerId, Role.ORGANIZER))
      .expect(409).expect({ statusCode: 409, error: 'Conflict', message: 'Event is not ready to publish' });
  });

  it('AC-2 lists published events only and hides drafts behind the same 404', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const published = await publishedEvent(organizerId);
    const draft = await publishedEvent(organizerId);
    await prisma.event.update({ where: { id: draft }, data: { status: 'DRAFT' } });

    const list = await http().get('/events').expect(200);
    const ids = list.body.map((entry: { id: string }) => entry.id);
    expect(ids).toContain(published);
    expect(ids).not.toContain(draft);
    expect(list.body.find((e: { id: string }) => e.id === published)).toMatchObject({ capacity: 3, remainingSeats: 3, priceCents: 3500 });
    expect(JSON.stringify(list.body)).not.toContain(organizerId);

    const detail = await http().get(`/events/${published}/public`).expect(200);
    expect(detail.body.seats.map((s: { seatLabel: string }) => s.seatLabel)).toEqual(['A1', 'A2', 'A3']);
    expect(detail.body.seats.every((s: { available: boolean }) => s.available)).toBe(true);

    await http().get(`/events/${draft}/public`).expect(404).expect({ statusCode: 404, error: 'Not Found', message: 'Event not found' });
    await http().get('/events/11111111-1111-4111-8111-111111111111/public').expect(404);
  });

  it('AC-3 never sells one seat twice and reclaims expired holds', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const one = await user(Role.CUSTOMER);
    const two = await user(Role.CUSTOMER);
    const eventId = await publishedEvent(organizerId);

    const [first, second] = await Promise.all([
      http().post('/reservations').set('Authorization', bearer(one, Role.CUSTOMER)).send({ eventId, seatLabels: ['A1'] }),
      http().post('/reservations').set('Authorization', bearer(two, Role.CUSTOMER)).send({ eventId, seatLabels: ['A1'] }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = [first, second].find((r) => r.status === 409);
    expect(refused?.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Seat is no longer available' });
    expect(await prisma.seatAllocation.count({ where: { releasedAt: null, eventSeat: { eventId } } })).toBe(1);

    // A hold one minute old still blocks the seat.
    now = new Date('2030-01-01T00:01:00.000Z');
    await http().post('/reservations').set('Authorization', bearer(two, Role.CUSTOMER)).send({ eventId, seatLabels: ['A1'] }).expect(409);

    // Past the ten-minute window the seat returns to stock.
    now = new Date('2030-01-01T00:11:00.000Z');
    await http().post('/reservations').set('Authorization', bearer(two, Role.CUSTOMER)).send({ eventId, seatLabels: ['A1'] }).expect(201);

    await http().post('/reservations').set('Authorization', bearer(one, Role.CUSTOMER)).send({ eventId, seatLabels: [] }).expect(400);
    await http().post('/reservations').set('Authorization', bearer(one, Role.CUSTOMER)).send({ eventId, seatLabels: ['Z9'] }).expect(400);
    await http().post('/reservations').set('Authorization', bearer(one, Role.CUSTOMER))
      .send({ eventId, seatLabels: ['A2', 'A2'] }).expect(400).expect({ statusCode: 400, error: 'Bad Request', message: 'seatLabels must be unique' });
  });

  it('AC-4 issues tickets on approval and frees seats on decline', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const customerId = await user(Role.CUSTOMER);
    const otherCustomer = await user(Role.CUSTOMER);
    const eventId = await publishedEvent(organizerId);

    const declined = await http().post('/reservations').set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ eventId, seatLabels: ['A1'] }).expect(201);
    const declineResult = await http().post(`/reservations/${declined.body.id}/payment`).set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ outcome: 'decline' }).expect(201);
    expect(declineResult.body.status).toBe('DECLINED');
    expect(await prisma.ticket.count({ where: { reservationId: declined.body.id } })).toBe(0);

    // The declined seat is immediately purchasable again.
    const paid = await http().post('/reservations').set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ eventId, seatLabels: ['A1', 'A2'] }).expect(201);
    expect(paid.body.totalCents).toBe(7000);
    const approved = await http().post(`/reservations/${paid.body.id}/payment`).set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ outcome: 'approve' }).expect(201);
    expect(approved.body.status).toBe('PAID');
    expect(await prisma.ticket.count({ where: { reservationId: paid.body.id } })).toBe(2);

    await http().post(`/reservations/${paid.body.id}/payment`).set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ outcome: 'approve' }).expect(409);
    await http().post(`/reservations/${paid.body.id}/payment`).set('Authorization', bearer(otherCustomer, Role.CUSTOMER))
      .send({ outcome: 'approve' }).expect(404);

    const expiring = await http().post('/reservations').set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ eventId, seatLabels: ['A3'] }).expect(201);
    now = new Date('2030-01-01T00:20:00.000Z');
    await http().post(`/reservations/${expiring.body.id}/payment`).set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ outcome: 'approve' }).expect(409).expect({ statusCode: 409, error: 'Conflict', message: 'Reservation has expired' });
    expect(await prisma.ticket.count({ where: { reservationId: expiring.body.id } })).toBe(0);
  });

  it('AC-5 and AC-6 reject forged QR codes and consume a ticket exactly once', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const customerId = await user(Role.CUSTOMER);
    const gateId = await user(Role.GATE);
    const eventId = await publishedEvent(organizerId);
    const otherEventId = await publishedEvent(organizerId);

    const [ticket] = await buyTicket(eventId, customerId, ['A1']);
    expect(ticket.qrPayload).toMatch(/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);

    const gate = (body: unknown) => http().post('/gate/validations').set('Authorization', bearer(gateId, Role.GATE)).send(body).expect(200);

    const tampered = `${ticket.qrPayload.slice(0, -1)}${ticket.qrPayload.at(-1) === 'A' ? 'B' : 'A'}`;
    expect((await gate({ qrPayload: tampered, eventId })).body.outcome).toBe('INVALID');
    const foreign = `v1.${randomUUID()}.${createHmac('sha256', 'a-different-secret').update('anything').digest('base64url')}`;
    expect((await gate({ qrPayload: foreign, eventId })).body.outcome).toBe('INVALID');

    // Correctly signed, but for a ticket that does not exist.
    const orphanId = randomUUID();
    const orphan = `v1.${orphanId}.${createHmac('sha256', qrSecret).update(`elite-ticketing:ticket:v1.${orphanId}`, 'utf8').digest('base64url')}`;
    expect((await gate({ qrPayload: orphan, eventId })).body.outcome).toBe('INVALID');

    // Wrong door must not burn the ticket.
    expect((await gate({ qrPayload: ticket.qrPayload, eventId: otherEventId })).body.outcome).toBe('WRONG_EVENT');
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).usedAt).toBeNull();

    const first = await gate({ qrPayload: ticket.qrPayload, eventId });
    expect(first.body).toMatchObject({ outcome: 'VALID', seatLabel: 'A1', eventTitle: 'Clube da Luta' });
    expect(first.body.usedAt).not.toBeNull();

    const second = await gate({ qrPayload: ticket.qrPayload, eventId });
    expect(second.body).toMatchObject({ outcome: 'ALREADY_USED', usedAt: first.body.usedAt });

    await http().post('/gate/validations').set('Authorization', bearer(customerId, Role.CUSTOMER))
      .send({ qrPayload: ticket.qrPayload, eventId }).expect(403);
  });

  it('AC-6 concurrent scans of one unused ticket yield a single VALID', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const customerId = await user(Role.CUSTOMER);
    const gateId = await user(Role.GATE);
    const eventId = await publishedEvent(organizerId);
    const [ticket] = await buyTicket(eventId, customerId, ['A1']);

    const scan = () => http().post('/gate/validations').set('Authorization', bearer(gateId, Role.GATE)).send({ qrPayload: ticket.qrPayload, eventId });
    const [one, two] = await Promise.all([scan(), scan()]);
    expect([one.body.outcome, two.body.outcome].sort()).toEqual(['ALREADY_USED', 'VALID']);
  });

  it('AC-7 shares a ticket by unguessable link without exposing the holder', async () => {
    const organizerId = await user(Role.ORGANIZER);
    const customerId = await user(Role.CUSTOMER);
    const eventId = await publishedEvent(organizerId);
    const [ticket] = await buyTicket(eventId, customerId, ['A1']);

    const shareToken = ticket.shareUrlPath.split('/').at(-1) as string;
    expect(shareToken.length).toBeGreaterThanOrEqual(40);
    expect(shareToken).not.toContain(ticket.id);

    const shared = await http().get(`/tickets/shared/${shareToken}`).expect(200);
    expect(shared.body).toMatchObject({ id: ticket.id, seatLabel: 'A1' });
    expect(JSON.stringify(shared.body)).not.toContain(customerId);
    expect(JSON.stringify(shared.body)).not.toContain(organizerId);

    await http().get('/tickets/shared/definitely-not-a-real-token').expect(404);
    await http().get('/tickets/me').expect(401);
  });
});
