import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { TicketQrService } from '../tickets/ticket-qr.service';

export type GateOutcome = 'VALID' | 'INVALID' | 'ALREADY_USED' | 'WRONG_EVENT';
export type GateValidationDto = {
  outcome: GateOutcome;
  seatLabel: string | null;
  eventTitle: string | null;
  usedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_FIELDS = ['qrPayload', 'eventId'];

@Injectable()
export class GateService {
  constructor(private readonly prisma: PrismaService, private readonly qr: TicketQrService) {}

  async validate(body: unknown): Promise<GateValidationDto> {
    const input = this.validateBody(body);

    // A forged or tampered payload never reaches the database.
    const ticketId = this.qr.verify(input.qrPayload);
    if (ticketId === null || !UUID.test(ticketId)) return this.outcome('INVALID');

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { eventSeat: { include: { event: true } } },
    });
    if (ticket === null) return this.outcome('INVALID');

    const seatLabel = ticket.eventSeat.seatLabel;
    const eventTitle = ticket.eventSeat.event.contentTitle;

    // Checked before the update so presenting a ticket at the wrong door never
    // consumes it.
    if (ticket.eventSeat.eventId !== input.eventId) {
      return { outcome: 'WRONG_EVENT', seatLabel, eventTitle, usedAt: ticket.usedAt?.toISOString() ?? null };
    }

    // The conditional update is the single-use invariant: two simultaneous
    // scans both reach it, but only one affects a row.
    const consumed = await this.prisma.$executeRaw`UPDATE "Ticket" SET "usedAt" = now() WHERE "id" = ${ticketId}::uuid AND "usedAt" IS NULL`;
    if (consumed === 0) {
      const current = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
      return { outcome: 'ALREADY_USED', seatLabel, eventTitle, usedAt: current?.usedAt?.toISOString() ?? null };
    }

    const stamped = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    return { outcome: 'VALID', seatLabel, eventTitle, usedAt: stamped.usedAt?.toISOString() ?? null };
  }

  private outcome(outcome: GateOutcome): GateValidationDto {
    return { outcome, seatLabel: null, eventTitle: null, usedAt: null };
  }

  private validateBody(value: unknown): { qrPayload: string; eventId: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new BadRequestException('request body must be a JSON object');
    }
    const input = value as Record<string, unknown>;
    const unknownField = Object.keys(input).filter((key) => !BODY_FIELDS.includes(key)).sort()[0];
    if (unknownField) throw new BadRequestException(`property ${unknownField} should not exist`);
    if (typeof input.qrPayload !== 'string' || input.qrPayload.length === 0) throw new BadRequestException('qrPayload must be a string');
    if (typeof input.eventId !== 'string' || !UUID.test(input.eventId)) throw new BadRequestException('eventId must be a UUID');
    return { qrPayload: input.qrPayload, eventId: input.eventId };
  }
}
