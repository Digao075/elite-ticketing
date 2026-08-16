import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Event } from '@prisma/client';

import { ContentSelectionTokenService, type EventContentSelection } from '../catalog/content-selection-token.service';
import { PrismaService } from '../database/prisma.service';

export const EVENTS_CLOCK = 'EVENTS_CLOCK';
export const AUDITORIUM_CLEANUP_MINUTES = 15;
export type EventsClock = () => Date;

export type CreateEventBody = { providerMovieId: number; selectionToken: string; startsAt: string; venueName: string; auditoriumName: string };
export type EventContentDto = EventContentSelection;
export type EventDto = { id: string; status: 'DRAFT' | 'PUBLISHED'; organizerId: string; startsAt: string; venueName: string; auditoriumName: string; content: EventContentDto; createdAt: string; updatedAt: string };

const INVALID_TOKEN = 'selectionToken is invalid or expired';
const INVALID_ACCESS = 'Invalid or expired access token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const CONTROL = /\p{Cc}/u;
const FIELDS = ['providerMovieId', 'selectionToken', 'startsAt', 'venueName', 'auditoriumName'];

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService, private readonly selections: ContentSelectionTokenService, @Inject(EVENTS_CLOCK) private readonly clock: EventsClock) {}

  async findOwnedById(organizerId: string, eventId: string): Promise<EventDto> {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizerId } });
    if (!event) throw new NotFoundException('Event not found');
    return this.dto(event);
  }

  async createDraft(input: { organizerId: string; idempotencyKey: unknown; body: CreateEventBody }): Promise<EventDto> {
    if (!await this.prisma.user.findUnique({ where: { id: input.organizerId } })) throw new UnauthorizedException(INVALID_ACCESS);
    const body = this.validateBodyShape(input.body);
    const content = this.selections.verify(body.selectionToken);
    if (!Number.isInteger(content.runtimeMinutes) || content.runtimeMinutes < 1 || content.runtimeMinutes > 2147483647) {
      throw new BadRequestException(INVALID_TOKEN);
    }
    if (content.providerMovieId !== body.providerMovieId) throw new BadRequestException(INVALID_TOKEN);
    this.validateRemainingBody(body);
    const idempotencyKey = this.validateKey(input.idempotencyKey);
    const startsAt = new Date(body.startsAt);
    const venueName = body.venueName.trim(); const auditoriumName = body.auditoriumName.trim();
    const venueKey = this.key(venueName); const auditoriumKey = this.key(auditoriumName);
    const movieEndsAt = new Date(startsAt.getTime() + content.runtimeMinutes * 60_000);
    const occupiedUntil = new Date(movieEndsAt.getTime() + AUDITORIUM_CLEANUP_MINUTES * 60_000);

    let retryError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizerId.toLowerCase()}:${idempotencyKey}`}, 0))`;
        const existing = await tx.event.findUnique({ where: { organizerId_idempotencyKey: { organizerId: input.organizerId, idempotencyKey } } });
        if (existing) {
          if (this.same(existing, body.providerMovieId, content, startsAt, venueKey, auditoriumKey)) return this.dto(existing);
          throw new ConflictException('Idempotency-Key was already used with a different request');
        }
        const event = await tx.event.create({ data: {
          organizerId: input.organizerId, idempotencyKey, startsAt, movieEndsAt, occupiedUntil, venueName, auditoriumName, venueKey, auditoriumKey,
          contentProviderMovieId: content.providerMovieId, contentTitle: content.title, contentReleaseDate: content.releaseDate,
          contentPosterPath: content.posterPath, contentBackdropPath: content.backdropPath, contentOverview: content.overview,
          contentRuntimeMinutes: content.runtimeMinutes, contentGenres: content.genres, contentOriginalLanguage: content.originalLanguage,
        } });
        return this.dto(event);
        });
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        if (this.isOccupancyError(error)) throw new ConflictException('Auditorium is unavailable for the requested time');
        if (this.isDeadlock(error) && attempt < 2) {
          retryError = error;
          continue;
        }
        throw error;
      }
    }
    throw retryError;
  }

  private validateBodyShape(value: unknown): CreateEventBody {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new BadRequestException('request body must be a JSON object');
    const input = value as Record<string, unknown>;
    const unknown = Object.keys(input).filter((key) => !FIELDS.includes(key)).sort()[0];
    if (unknown) throw new BadRequestException(`property ${unknown} should not exist`);
    if (!Number.isInteger(input.providerMovieId) || (input.providerMovieId as number) < 1 || (input.providerMovieId as number) > 2147483647) throw new BadRequestException('providerMovieId must be a positive 32-bit integer');
    if (typeof input.selectionToken !== 'string' || input.selectionToken.length === 0) throw new BadRequestException(INVALID_TOKEN);
    return input as CreateEventBody;
  }

  private validateRemainingBody(input: CreateEventBody): void {
    if (typeof input.startsAt !== 'string' || !this.isValidFutureTimestamp(input.startsAt)) throw new BadRequestException('startsAt must be a future RFC 3339 timestamp with an explicit UTC offset');
    this.validateName(input.venueName, 120, 'venueName'); this.validateName(input.auditoriumName, 80, 'auditoriumName');
  }

  private validateName(value: unknown, maximum: number, field: 'venueName' | 'auditoriumName'): asserts value is string {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > maximum || CONTROL.test(value)) throw new BadRequestException(`${field} must contain 1 to ${maximum} characters after trimming and no control characters`);
  }
  private validateKey(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('Idempotency-Key must be a UUID'); return value.toLowerCase(); }
  private isValidFutureTimestamp(value: string): boolean {
    const match = RFC3339.exec(value);
    if (!match || Number.isNaN(Date.parse(value))) return false;
    const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
    if (hour > 23 || minute > 59 || second > 59) return false;
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    calendar.setUTCHours(hour, minute, second, 0);
    return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day && new Date(value) > this.clock();
  }
  private key(value: string): string { return value.normalize('NFKC').trim().replace(/\p{White_Space}+/gu, ' ').toLowerCase(); }
  private same(event: Event, providerMovieId: number, content: EventContentSelection, startsAt: Date, venueKey: string, auditoriumKey: string): boolean {
    return event.contentProviderMovieId === providerMovieId && event.startsAt.getTime() === startsAt.getTime() && event.venueKey === venueKey && event.auditoriumKey === auditoriumKey &&
      event.contentTitle === content.title && event.contentReleaseDate === content.releaseDate && event.contentPosterPath === content.posterPath && event.contentBackdropPath === content.backdropPath && event.contentOverview === content.overview && event.contentRuntimeMinutes === content.runtimeMinutes && event.contentOriginalLanguage === content.originalLanguage && event.contentGenres.length === content.genres.length && event.contentGenres.every((genre, index) => genre === content.genres[index]);
  }
  private dto(event: Event): EventDto { return { id: event.id, status: event.status, organizerId: event.organizerId, startsAt: event.startsAt.toISOString(), venueName: event.venueName, auditoriumName: event.auditoriumName, content: { providerMovieId: event.contentProviderMovieId, title: event.contentTitle, releaseDate: event.contentReleaseDate, posterPath: event.contentPosterPath, backdropPath: event.contentBackdropPath, overview: event.contentOverview, runtimeMinutes: event.contentRuntimeMinutes, genres: event.contentGenres, originalLanguage: event.contentOriginalLanguage }, createdAt: event.createdAt.toISOString(), updatedAt: event.updatedAt.toISOString() }; }
  private isOccupancyError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('Event_auditorium_occupancy_excl');
  }
  private isDeadlock(error: unknown): boolean {
    return error instanceof Error && error.message.includes('deadlock detected');
  }
}
