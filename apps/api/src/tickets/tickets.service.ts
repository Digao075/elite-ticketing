import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { toPublicEvent, type PublicEventDto } from '../events/event-view';
import { TicketQrService } from './ticket-qr.service';

export type TicketDto = {
  id: string;
  seatLabel: string;
  usedAt: string | null;
  qrPayload: string;
  shareUrlPath: string;
  event: PublicEventDto;
};

const ticketShape = { reservation: { include: { event: true } }, eventSeat: true } as const;

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService, private readonly qr: TicketQrService) {}

  async listMine(customerId: string): Promise<TicketDto[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: { reservation: { customerId, status: 'PAID' } },
      include: ticketShape,
      orderBy: { createdAt: 'asc' },
    });
    return tickets.map((ticket) => this.dto(ticket));
  }

  async findShared(shareToken: string): Promise<TicketDto> {
    const ticket = await this.prisma.ticket.findUnique({ where: { shareToken }, include: ticketShape });
    if (ticket === null) throw new NotFoundException('Ticket not found');
    return this.dto(ticket);
  }

  private dto(ticket: {
    id: string;
    usedAt: Date | null;
    shareToken: string;
    eventSeat: { seatLabel: string };
    reservation: { event: Parameters<typeof toPublicEvent>[0] };
  }): TicketDto {
    return {
      id: ticket.id,
      seatLabel: ticket.eventSeat.seatLabel,
      usedAt: ticket.usedAt === null ? null : ticket.usedAt.toISOString(),
      qrPayload: this.qr.sign(ticket.id),
      shareUrlPath: `/tickets/shared/${ticket.shareToken}`,
      event: toPublicEvent(ticket.reservation.event),
    };
  }
}
