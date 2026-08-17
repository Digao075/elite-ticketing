import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

export type PublishedEventDto = { id: string; status: 'PUBLISHED'; priceCents: number; capacity: number };

@Injectable()
export class EventPublicationService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(organizerId: string, eventId: string): Promise<PublishedEventDto> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Event" WHERE "id" = ${eventId}::uuid AND "organizerId" = ${organizerId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Event not found');

      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { _count: { select: { seats: true } } } });
      const capacity = event._count.seats;

      // Publishing is idempotent: a second call observes the same state rather
      // than failing, so a retried request cannot surprise the organizer.
      if (event.status === 'PUBLISHED') {
        return { id: event.id, status: 'PUBLISHED' as const, priceCents: event.priceCents ?? 0, capacity };
      }

      if (event.priceCents === null || capacity === 0) {
        throw new ConflictException('Event is not ready to publish');
      }

      await tx.event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } });
      return { id: event.id, status: 'PUBLISHED' as const, priceCents: event.priceCents, capacity };
    });
  }
}
