import { BadGatewayException, Inject, Injectable } from '@nestjs/common';

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

type TmdbMovie = {
  id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  overview: string;
  adult: boolean;
};

const PROVIDER_UNAVAILABLE_MESSAGE = 'Catalog provider unavailable';

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
      candidate.id <= 0 ||
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
