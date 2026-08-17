import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const SHARE_TOKEN_BYTES = 32;

/**
 * The QR payload is `v1.<ticketId>.<HMAC-SHA256>`.
 *
 * Only the ticket id travels in the clear; the signature proves this service
 * issued it. Nothing secret is stored alongside the ticket, so a database
 * reader still cannot mint a payload, and the ticket can be re-rendered at any
 * time without keeping a raw credential.
 */
@Injectable()
export class TicketQrService {
  sign(ticketId: string): string {
    return `${VERSION}.${ticketId}.${this.signature(ticketId)}`;
  }

  /** Returns the ticket id only when the payload is intact, otherwise null. */
  verify(payload: unknown): string | null {
    if (typeof payload !== 'string') return null;

    const parts = payload.split('.');
    if (parts.length !== 3) return null;

    const [version, ticketId, provided] = parts;
    if (version !== VERSION || ticketId.length === 0) return null;

    const expected = Buffer.from(this.signature(ticketId));
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length) return null;

    return timingSafeEqual(expected, actual) ? ticketId : null;
  }

  createShareToken(): string {
    return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
  }

  private signature(ticketId: string): string {
    return createHmac('sha256', this.secret()).update(`elite-ticketing:ticket:${VERSION}.${ticketId}`, 'utf8').digest('base64url');
  }

  private secret(): string {
    const secret = process.env.TICKET_QR_SECRET;
    if (typeof secret !== 'string' || secret.trim() === '') {
      throw new Error('TICKET_QR_SECRET is required');
    }
    return secret;
  }
}
