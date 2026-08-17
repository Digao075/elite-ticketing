import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { toPublicEvent, type PublicEventDto } from '../events/event-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EventListEntryDto = PublicEventDto & { capacity: number; remainingSeats: number };
export type PublicSeatDto = { id: string; seatLabel: string; rowLabel: string; seatNumber: number; available: boolean };
export type EventDetailDto = PublicEventDto & { capacity: number; remainingSeats: number; seats: PublicSeatDto[] };

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<EventListEntryDto[]> {
    const events = await this.prisma.event.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { startsAt: 'asc' },
      include: { seats: { include: { allocation: { where: { releasedAt: null } } } } },
    });

    return events.map((event) => ({
      ...toPublicEvent(event),
      capacity: event.seats.length,
      remainingSeats: event.seats.filter((seat) => seat.allocation.length === 0).length,
    }));
  }

  async findPublished(eventId: string): Promise<EventDetailDto> {
    if (!UUID.test(eventId)) throw new BadRequestException('eventId must be a UUID');

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: 'PUBLISHED' },
      include: {
        seats: {
          orderBy: [{ rowLabel: 'asc' }, { seatNumber: 'asc' }],
          include: { allocation: { where: { releasedAt: null } } },
        },
      },
    });
    // A DRAFT event is reported exactly like an absent one so discovery cannot
    // be used to enumerate events an organizer has not published yet.
    if (event === null) throw new NotFoundException('Event not found');

    const seats = event.seats.map((seat) => ({
      id: seat.id,
      seatLabel: seat.seatLabel,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      available: seat.allocation.length === 0,
    }));

    return {
      ...toPublicEvent(event),
      capacity: seats.length,
      remainingSeats: seats.filter((seat) => seat.available).length,
      seats,
    };
  }
}
