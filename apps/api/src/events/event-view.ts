import type { Event } from '@prisma/client';

export type PublicEventContent = {
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

export type PublicEventDto = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  auditoriumName: string;
  priceCents: number;
  content: PublicEventContent;
};

/**
 * The public projection of an event. It deliberately omits organizerId,
 * idempotencyKey, occupiedUntil and status so discovery cannot leak who owns
 * an event or how scheduling is enforced.
 */
export function toPublicEvent(event: Event): PublicEventDto {
  return {
    id: event.id,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.movieEndsAt.toISOString(),
    venueName: event.venueName,
    auditoriumName: event.auditoriumName,
    priceCents: event.priceCents ?? 0,
    content: {
      providerMovieId: event.contentProviderMovieId,
      title: event.contentTitle,
      releaseDate: event.contentReleaseDate,
      posterPath: event.contentPosterPath,
      backdropPath: event.contentBackdropPath,
      overview: event.contentOverview,
      runtimeMinutes: event.contentRuntimeMinutes,
      genres: event.contentGenres,
      originalLanguage: event.contentOriginalLanguage,
    },
  };
}
