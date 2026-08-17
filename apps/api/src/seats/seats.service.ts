import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EventSeat } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

export type ConfigureEventSeatsBody = { priceCents: number; rows: Array<{ label: string; seatCount: number }> };
export type EventSeatDto = { id: string; seatLabel: string; rowLabel: string; seatNumber: number };
export type EventSeatingDto = { eventId: string; currency: 'BRL'; priceCents: number; capacity: number; seats: EventSeatDto[] };

const FIELDS = ['priceCents', 'rows'];
const ROW_FIELDS = ['label', 'seatCount'];

@Injectable()
export class SeatsService {
  constructor(private readonly prisma: PrismaService) {}

  async replaceDraftConfiguration(organizerId: string, eventId: string, body: unknown): Promise<EventSeatingDto> {
    const input = this.validate(body);
    const requested = input.rows.flatMap(({ label, seatCount }) => Array.from({ length: seatCount }, (_, index) => ({ seatLabel: `${label}${index + 1}`, rowLabel: label, seatNumber: index + 1 })));
    requested.sort((left, right) => left.rowLabel.localeCompare(right.rowLabel) || left.seatNumber - right.seatNumber);

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${eventId}::uuid AND "organizerId" = ${organizerId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Event not found');
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { seats: { orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }] } } });
      if (event.status === 'PUBLISHED') throw new ConflictException('Published event seating cannot be changed');
      if (event.priceCents === input.priceCents && this.sameSeats(event.seats, requested)) return this.dto(event.id, event.priceCents, event.seats);

      await tx.eventSeat.deleteMany({ where: { eventId } });
      await tx.eventSeat.createMany({ data: requested.map((seat) => ({ eventId, ...seat })) });
      await tx.event.update({ where: { id: eventId }, data: { priceCents: input.priceCents } });
      const seats = await tx.eventSeat.findMany({ where: { eventId }, orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }] });
      return this.dto(eventId, input.priceCents, seats);
    });
  }

  private validate(value: unknown): ConfigureEventSeatsBody {
    if (!this.plainObject(value)) throw new BadRequestException('request body must be a JSON object');
    const input = value as Record<string, unknown>;
    const unknown = Object.keys(input).filter((key) => !FIELDS.includes(key)).sort()[0];
    if (unknown) throw new BadRequestException(`property ${unknown} should not exist`);
    if (!Number.isInteger(input.priceCents) || (input.priceCents as number) < 100 || (input.priceCents as number) > 1_000_000) throw new BadRequestException('priceCents must be an integer from 100 to 1000000');
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 26) throw new BadRequestException('rows must contain 1 to 26 entries');
    const labels = new Set<string>();
    for (const [index, row] of input.rows.entries()) {
      if (!this.plainObject(row)) throw new BadRequestException(`rows[${index}] must be a JSON object`);
      const unknownRow = Object.keys(row).filter((key) => !ROW_FIELDS.includes(key)).sort()[0];
      if (unknownRow) throw new BadRequestException(`property rows[${index}].${unknownRow} should not exist`);
      if (typeof row.label !== 'string' || !/^[A-Z]$/.test(row.label)) throw new BadRequestException(`rows[${index}].label must be one uppercase letter A-Z`);
      if (!Number.isInteger(row.seatCount) || (row.seatCount as number) < 1 || (row.seatCount as number) > 50) throw new BadRequestException(`rows[${index}].seatCount must be an integer from 1 to 50`);
      if (labels.has(row.label)) throw new BadRequestException('rows labels must be unique');
      labels.add(row.label);
    }
    const rows = input.rows as Array<{ label: string; seatCount: number }>;
    if (rows.reduce((total, row) => total + row.seatCount, 0) > 500) throw new BadRequestException('rows must define at most 500 seats');
    return { priceCents: input.priceCents as number, rows };
  }

  private plainObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
  private sameSeats(stored: EventSeat[], requested: Array<Omit<EventSeatDto, 'id'>>): boolean { return stored.length === requested.length && stored.every((seat, index) => seat.seatLabel === requested[index].seatLabel && seat.rowLabel === requested[index].rowLabel && seat.seatNumber === requested[index].seatNumber); }
  private dto(eventId: string, priceCents: number, seats: EventSeat[]): EventSeatingDto { return { eventId, currency: 'BRL', priceCents, capacity: seats.length, seats: seats.map(({ id, seatLabel, rowLabel, seatNumber }) => ({ id, seatLabel, rowLabel, seatNumber })) }; }
}
