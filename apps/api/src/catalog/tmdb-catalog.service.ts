import { BadGatewayException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import type { EventContentSelection } from './content-selection-token.service';

export const TMDB_FETCH = 'TMDB_FETCH';
export const TMDB_HTTP_TIMEOUT_MS = 5000;

export type TmdbFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type CatalogMovieSummary = {
  providerMovieId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  overview: string;
};

export type CatalogMovieDetail = CatalogMovieSummary & {
  runtimeMinutes: number | null;
  genres: string[];
};

type TmdbMovie = {
  id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  overview: string;
  adult: boolean;
};

type TmdbMovieDetail = TmdbMovie & {
  runtime: number | null;
  genres: { name: string }[];
  backdrop_path?: string | null;
  original_language?: string;
};

const PROVIDER_UNAVAILABLE_MESSAGE = 'Catalog provider unavailable';
const UNSCHEDULABLE_SELECTION_MESSAGE = 'Selected movie must have a positive runtime';

@Injectable()
export class TmdbCatalogService {
  private readonly apiKey: string;

  constructor(@Inject(TMDB_FETCH) private readonly tmdbFetch: TmdbFetch) {
    const apiKey = process.env.TMDB_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('TMDB_API_KEY is required');
    }

    this.apiKey = apiKey;
  }

  async searchMovies(query: string): Promise<CatalogMovieSummary[]> {
    const url = new URL('https://api.themoviedb.org/3/search/movie');
    url.search = new URLSearchParams({
      api_key: this.apiKey,
      query,
      language: 'pt-BR',
      region: 'BR',
      include_adult: 'false',
      page: '1',
    }).toString();

    try {
      const response = await this.tmdbFetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TMDB_HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error('TMDb returned an unsuccessful response');
      }

      return this.normalizeSearchPayload(await response.json());
    } catch {
      throw new BadGatewayException(PROVIDER_UNAVAILABLE_MESSAGE);
    }
  }

  async listPopularMovies(): Promise<CatalogMovieSummary[]> {
    const url = new URL('https://api.themoviedb.org/3/movie/popular');
    url.search = new URLSearchParams({
      api_key: this.apiKey,
      language: 'pt-BR',
      region: 'BR',
      page: '1',
    }).toString();

    try {
      const response = await this.tmdbFetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TMDB_HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error('TMDb returned an unsuccessful response');
      }

      return this.normalizeSearchPayload(await response.json());
    } catch {
      throw new BadGatewayException(PROVIDER_UNAVAILABLE_MESSAGE);
    }
  }

  async getMovieDetails(providerMovieId: number): Promise<CatalogMovieDetail> {
    const url = new URL(`https://api.themoviedb.org/3/movie/${providerMovieId}`);
    url.search = new URLSearchParams({
      api_key: this.apiKey,
      language: 'pt-BR',
      region: 'BR',
      include_adult: 'false',
    }).toString();

    try {
      const response = await this.tmdbFetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TMDB_HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error('TMDb returned an unsuccessful response');
      }

      return this.normalizeDetailPayload(await response.json(), providerMovieId);
    } catch {
      throw new BadGatewayException(PROVIDER_UNAVAILABLE_MESSAGE);
    }
  }

  async getMovieSelectionDetails(providerMovieId: number): Promise<EventContentSelection> {
    let detail: CatalogMovieDetail & { backdropPath: string | null; originalLanguage: string };
    try {
      const response = await this.tmdbFetch(this.detailUrl(providerMovieId), {
        method: 'GET',
        signal: AbortSignal.timeout(TMDB_HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('TMDb returned an unsuccessful response');
      detail = this.normalizeSelectionDetailPayload(await response.json(), providerMovieId);
    } catch {
      throw new BadGatewayException(PROVIDER_UNAVAILABLE_MESSAGE);
    }

    const { runtimeMinutes } = detail;
    if (runtimeMinutes === null || runtimeMinutes === 0) {
      throw new UnprocessableEntityException(UNSCHEDULABLE_SELECTION_MESSAGE);
    }

    return { ...detail, runtimeMinutes };
  }

  private normalizeSearchPayload(payload: unknown): CatalogMovieSummary[] {
    if (!this.isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error('Invalid TMDb search payload');
    }

    const movies: CatalogMovieSummary[] = [];
    for (const candidate of payload.results) {
      if (this.isRecord(candidate) && candidate.adult === true) {
        continue;
      }

      const movie = this.validateMovie(candidate);
      movies.push({
        providerMovieId: movie.id,
        title: movie.title,
        releaseDate: movie.release_date,
        posterPath: movie.poster_path,
        overview: movie.overview,
      });
      if (movies.length === 10) {
        break;
      }
    }

    return movies;
  }

  private validateMovie(candidate: unknown): TmdbMovie {
    if (
      !this.isRecord(candidate) ||
      !Number.isInteger(candidate.id) ||
      (candidate.id as number) <= 0 ||
      typeof candidate.title !== 'string' ||
      (typeof candidate.release_date !== 'string' && candidate.release_date !== null) ||
      (typeof candidate.poster_path !== 'string' && candidate.poster_path !== null) ||
      typeof candidate.overview !== 'string' ||
      typeof candidate.adult !== 'boolean'
    ) {
      throw new Error('Invalid TMDb movie');
    }

    return candidate as TmdbMovie;
  }

  private normalizeDetailPayload(payload: unknown, providerMovieId: number): CatalogMovieDetail {
    const detail = this.validateMovie(payload) as TmdbMovieDetail;
    if (
      detail.id !== providerMovieId ||
      detail.adult !== false ||
      (detail.runtime !== null && (!Number.isInteger(detail.runtime) || detail.runtime < 0)) ||
      !Array.isArray(detail.genres) ||
      !detail.genres.every(
        (genre) => this.isRecord(genre) && typeof genre.name === 'string' && genre.name.length > 0,
      )
    ) {
      throw new Error('Invalid TMDb movie detail');
    }

    return {
      providerMovieId: detail.id,
      title: detail.title,
      releaseDate: detail.release_date,
      posterPath: detail.poster_path,
      overview: detail.overview,
      runtimeMinutes: detail.runtime,
      genres: detail.genres.map((genre) => genre.name),
    };
  }

  private normalizeSelectionDetailPayload(
    payload: unknown,
    providerMovieId: number,
  ): CatalogMovieDetail & { backdropPath: string | null; originalLanguage: string } {
    const detail = this.normalizeDetailPayload(payload, providerMovieId);
    if (!this.isRecord(payload) || (typeof payload.backdrop_path !== 'string' && payload.backdrop_path !== null) ||
      typeof payload.original_language !== 'string' || payload.original_language.length === 0) {
      throw new Error('Invalid TMDb selection detail');
    }
    return { ...detail, backdropPath: payload.backdrop_path, originalLanguage: payload.original_language };
  }

  private detailUrl(providerMovieId: number): URL {
    const url = new URL(`https://api.themoviedb.org/3/movie/${providerMovieId}`);
    url.search = new URLSearchParams({
      api_key: this.apiKey,
      language: 'pt-BR',
      region: 'BR',
      include_adult: 'false',
    }).toString();
    return url;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
