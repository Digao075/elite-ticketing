import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CONTENT_SELECTION_CLOCK = 'CONTENT_SELECTION_CLOCK';
export const CONTENT_SELECTION_SECRET = 'CONTENT_SELECTION_SECRET';
export const CONTENT_SELECTION_TTL_SECONDS = 1800;

export type ContentSelectionClock = () => Date;

export type EventContentSelection = {
  providerMovieId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  runtimeMinutes: number;
  genres: string[];
  originalLanguage: string;
};

export type SignedEventContentSelection = EventContentSelection & {
  version: 1;
  issuedAt: number;
  expiresAt: number;
};

export type SelectionResponse = {
  selectionToken: string;
  expiresIn: 1800;
};

const INVALID_TOKEN_MESSAGE = 'selectionToken is invalid or expired';
const PAYLOAD_KEYS = [
  'providerMovieId', 'title', 'releaseDate', 'posterPath', 'backdropPath', 'overview',
  'runtimeMinutes', 'genres', 'originalLanguage', 'version', 'issuedAt', 'expiresAt',
] as const;

@Injectable()
export class ContentSelectionTokenService {
  constructor(
    @Inject(CONTENT_SELECTION_SECRET) private readonly secret: string,
    @Inject(CONTENT_SELECTION_CLOCK) private readonly clock: ContentSelectionClock,
  ) {}

  issue(content: EventContentSelection): string {
    const issuedAt = Math.floor(this.clock().getTime() / 1000);
    const payload: SignedEventContentSelection = {
      providerMovieId: content.providerMovieId,
      title: content.title,
      releaseDate: content.releaseDate,
      posterPath: content.posterPath,
      backdropPath: content.backdropPath,
      overview: content.overview,
      runtimeMinutes: content.runtimeMinutes,
      genres: content.genres,
      originalLanguage: content.originalLanguage,
      version: 1,
      issuedAt,
      expiresAt: issuedAt + CONTENT_SELECTION_TTL_SECONDS,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `v1.${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  verify(selectionToken: string): SignedEventContentSelection {
    try {
      if (typeof selectionToken !== 'string' || selectionToken.trim() === '') throw new Error();
      const segments = selectionToken.split('.');
      if (segments.length !== 3 || segments[0] !== 'v1' || !this.isBase64Url(segments[1]) || !this.isBase64Url(segments[2])) {
        throw new Error();
      }

      const expectedSignature = Buffer.from(this.sign(segments[1]), 'utf8');
      const signature = Buffer.from(segments[2], 'utf8');
      if (signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) throw new Error();

      const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
      if (!this.isValidPayload(payload)) throw new Error();
      return payload;
    } catch {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.secret)
      .update(`elite-ticketing:content-selection:v1.${encodedPayload}`, 'utf8')
      .digest('base64url');
  }

  private isBase64Url(value: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(value);
  }

  private isValidPayload(value: unknown): value is SignedEventContentSelection {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const payload = value as Record<string, unknown>;
    if (Object.keys(payload).length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((key) => Object.hasOwn(payload, key))) return false;
    if (
      payload.version !== 1 || !this.isPositiveInt32(payload.providerMovieId) || typeof payload.title !== 'string' ||
      !this.isNullableString(payload.releaseDate) || !this.isNullableString(payload.posterPath) ||
      !this.isNullableString(payload.backdropPath) || typeof payload.overview !== 'string' ||
      !Number.isInteger(payload.runtimeMinutes) || (payload.runtimeMinutes as number) <= 0 ||
      !Array.isArray(payload.genres) || !payload.genres.every((genre) => typeof genre === 'string' && genre.length > 0) ||
      typeof payload.originalLanguage !== 'string' || payload.originalLanguage.length === 0 ||
      !Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt) ||
      (payload.issuedAt as number) > Math.floor(this.clock().getTime() / 1000) ||
      payload.expiresAt !== (payload.issuedAt as number) + CONTENT_SELECTION_TTL_SECONDS ||
      (payload.expiresAt as number) <= Math.floor(this.clock().getTime() / 1000)
    ) return false;
    return true;
  }

  private isPositiveInt32(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
  }

  private isNullableString(value: unknown): value is string | null {
    return typeof value === 'string' || value === null;
  }
}
