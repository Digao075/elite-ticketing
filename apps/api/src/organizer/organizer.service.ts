import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

export type OrganizerEventContentDto = {
  title: string;
  posterPath: string | null;
  runtimeMinutes: number;
  genres: string[];
};

export type OrganizerEventDto = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  startsAt: string;
  venueName: string;
  auditoriumName: string;
  priceCents: number | null;
  capacity: number;
  ticketsSold: number;
  remainingSeats: number;
  revenueCents: number;
  readyToPublish: boolean;
  content: OrganizerEventContentDto;
};

@Injectable()
export class OrganizerService {
  constructor(private readonly prisma: PrismaService) {}

  async listOwnEvents(organizerId: string): Promise<OrganizerEventDto[]> {
    const events = await this.prisma.event.findMany({
      where: { organizerId },
      orderBy: { startsAt: 'desc' },
      include: {
        seats: {
          include: {
            // Only unreleased allocations occupy a seat; a refused payment
            // releases its row and the seat becomes sellable again.
            allocation: { where: { releasedAt: null } },
            ticket: true,
          },
        },
      },
    });

    return events.map((event) => {
      const capacity = event.seats.length;
      const ticketsSold = event.seats.filter((seat) => seat.ticket !== null).length;
      const remainingSeats = event.seats.filter((seat) => seat.allocation.length === 0).length;

      return {
        id: event.id,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        venueName: event.venueName,
        auditoriumName: event.auditoriumName,
        priceCents: event.priceCents,
        capacity,
        ticketsSold,
        remainingSeats,
        revenueCents: (event.priceCents ?? 0) * ticketsSold,
        // Mirrors exactly what the publish endpoint enforces, so the dashboard
        // never offers a button the API would reject.
        readyToPublish: event.status === 'DRAFT' && event.priceCents !== null && capacity > 0,
        content: {
          title: event.contentTitle,
          posterPath: event.contentPosterPath,
          runtimeMinutes: event.contentRuntimeMinutes,
          genres: event.contentGenres,
        },
      };
    });
  }
}
