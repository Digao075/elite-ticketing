import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { TicketQrService } from '../tickets/ticket-qr.service';

export const RESERVATIONS_CLOCK = 'RESERVATIONS_CLOCK';
export type Clock = () => Date;

export const HOLD_MINUTES = 10;
const MAX_SEATS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_FIELDS = ['eventId', 'seatLabels'];

export type CreateReservationBody = { eventId: string; seatLabels: string[] };
export type ReservationSeatDto = { seatLabel: string; rowLabel: string; seatNumber: number };
export type ReservationDto = {
  id: string;
  eventId: string;
  status: 'PENDING' | 'PAID' | 'DECLINED';
  expiresAt: string;
  totalCents: number;
  seats: ReservationSeatDto[];
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: TicketQrService,
    @Inject(RESERVATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async create(customerId: string, body: unknown): Promise<ReservationDto> {
    const input = this.validateCreate(body);
    const now = this.clock();

    return this.prisma.$transaction(async (tx) => {
      // Locking the event serializes every reservation for it, so two callers
      // racing for the same seat resolve in order instead of interleaving.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${input.eventId}::uuid AND "status" = 'PUBLISHED' FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Event not found');

      // Expired holds are reclaimed here rather than by a scheduler: the only
      // moment their staleness matters is when somebody wants the seat.
      await tx.$executeRaw`
        UPDATE "SeatAllocation" SET "releasedAt" = ${now}
        FROM "Reservation"
        WHERE "SeatAllocation"."reservationId" = "Reservation"."id"
          AND "SeatAllocation"."releasedAt" IS NULL
          AND "Reservation"."status" = 'PENDING'
          AND "Reservation"."expiresAt" <= ${now}
          AND "Reservation"."eventId" = ${input.eventId}::uuid`;

      const seats = await tx.eventSeat.findMany({
        where: { eventId: input.eventId, seatLabel: { in: input.seatLabels } },
        orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }],
      });
      if (seats.length !== input.seatLabels.length) throw new BadRequestException('Unknown seat label');

      const reservation = await tx.reservation.create({
        data: { eventId: input.eventId, customerId, expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000) },
      });

      try {
        await tx.seatAllocation.createMany({ data: seats.map((seat) => ({ eventSeatId: seat.id, reservationId: reservation.id })) });
      } catch (error) {
        // The partial unique index is what actually refuses the double sale.
        if (isUniqueViolation(error)) throw new ConflictException('Seat is no longer available');
        throw error;
      }

      const event = await tx.event.findUniqueOrThrow({ where: { id: input.eventId } });
      return this.dto(reservation.id, input.eventId, 'PENDING', reservation.expiresAt, seats, event.priceCents ?? 0);
    });
  }

  async pay(customerId: string, reservationId: string, body: unknown): Promise<ReservationDto> {
    const outcome = this.validatePayment(body);
    const now = this.clock();

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId}::uuid AND "customerId" = ${customerId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Reservation not found');

      const reservation = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { allocations: { where: { releasedAt: null }, include: { eventSeat: true } }, event: true },
      });
      if (reservation.status !== 'PENDING') throw new ConflictException('Reservation is no longer pending');

      const seats = reservation.allocations
        .map((allocation) => allocation.eventSeat)
        .sort((left, right) => left.rowLabel.localeCompare(right.rowLabel) || left.seatNumber - right.seatNumber);
      const priceCents = reservation.event.priceCents ?? 0;

      if (reservation.expiresAt <= now) {
        await this.release(tx, reservationId, now);
        throw new ConflictException('Reservation has expired');
      }

      if (outcome === 'decline') {
        await this.release(tx, reservationId, now);
        return this.dto(reservationId, reservation.eventId, 'DECLINED', reservation.expiresAt, seats, priceCents);
      }

      await tx.reservation.update({ where: { id: reservationId }, data: { status: 'PAID' } });
      await tx.ticket.createMany({
        data: reservation.allocations.map((allocation) => ({
          reservationId,
          eventSeatId: allocation.eventSeatId,
          shareToken: this.qr.createShareToken(),
        })),
      });

      return this.dto(reservationId, reservation.eventId, 'PAID', reservation.expiresAt, seats, priceCents);
    });
  }

  private async release(tx: Prisma.TransactionClient, reservationId: string, now: Date): Promise<void> {
    await tx.seatAllocation.updateMany({ where: { reservationId, releasedAt: null }, data: { releasedAt: now } });
    await tx.reservation.update({ where: { id: reservationId }, data: { status: 'DECLINED' } });
  }

  private dto(id: string, eventId: string, status: ReservationDto['status'], expiresAt: Date, seats: ReservationSeatDto[], priceCents: number): ReservationDto {
    return {
      id,
      eventId,
      status,
      expiresAt: expiresAt.toISOString(),
      totalCents: priceCents * seats.length,
      seats: seats.map(({ seatLabel, rowLabel, seatNumber }) => ({ seatLabel, rowLabel, seatNumber })),
    };
  }

  private validateCreate(value: unknown): CreateReservationBody {
    const input = this.plainObject(value);
    const unknownField = Object.keys(input).filter((key) => !BODY_FIELDS.includes(key)).sort()[0];
    if (unknownField) throw new BadRequestException(`property ${unknownField} should not exist`);
    if (typeof input.eventId !== 'string' || !UUID.test(input.eventId)) throw new BadRequestException('eventId must be a UUID');
    if (!Array.isArray(input.seatLabels) || input.seatLabels.length < 1 || input.seatLabels.length > MAX_SEATS) {
      throw new BadRequestException(`seatLabels must contain 1 to ${MAX_SEATS} entries`);
    }
    if (!input.seatLabels.every((label) => typeof label === 'string' && /^[A-Z][0-9]{1,2}$/.test(label))) {
      throw new BadRequestException('seatLabels must be seat labels such as A1');
    }
    if (new Set(input.seatLabels).size !== input.seatLabels.length) throw new BadRequestException('seatLabels must be unique');
    return { eventId: input.eventId, seatLabels: input.seatLabels as string[] };
  }

  private validatePayment(value: unknown): 'approve' | 'decline' {
    const input = this.plainObject(value);
    const unknownField = Object.keys(input).filter((key) => key !== 'outcome').sort()[0];
    if (unknownField) throw new BadRequestException(`property ${unknownField} should not exist`);
    if (input.outcome !== 'approve' && input.outcome !== 'decline') throw new BadRequestException('outcome must be approve or decline');
    return input.outcome;
  }

  private plainObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new BadRequestException('request body must be a JSON object');
    }
    return value as Record<string, unknown>;
  }
}
