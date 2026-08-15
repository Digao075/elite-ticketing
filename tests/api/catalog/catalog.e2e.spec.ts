import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { TMDB_FETCH, TMDB_HTTP_TIMEOUT_MS, type TmdbFetch } from '../../../apps/api/src/catalog/tmdb-catalog.service';

const testSigningSecret = 'catalog-e2e-test-signing-secret';
const testUserId = 'b6a05095-6ef7-4f77-b654-6ac6c7d5cf73';
const tmdbApiKey = 'test-only-inert-tmdb-key';
const badQueryResponse = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'query must contain 1 to 100 characters after trimming',
};
const unauthorizedResponse = {
  statusCode: 401,
  error: 'Unauthorized',
  message: 'Invalid or expired access token',
};
const forbiddenResponse = {
  statusCode: 403,
  error: 'Forbidden',
  message: 'Insufficient role',
};
const providerUnavailableResponse = {
  statusCode: 502,
  error: 'Bad Gateway',
  message: 'Catalog provider unavailable',
};

type TokenPayload = { exp: number; role: Role; sub: string };

function organizerToken(role: Role = Role.ORGANIZER): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: testUserId, role, exp: Math.floor(Date.now() / 1000) + 60 } satisfies TokenPayload),
  ).toString('base64url');
  const signature = createHmac('sha256', testSigningSecret).update(`${header}.${payload}`).digest('base64url');

  return `${header}.${payload}.${signature}`;
}

function providerMovie(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Movie ${id}`,
    release_date: '2002-08-30',
    poster_path: `/poster-${id}.jpg`,
    overview: `Overview ${id}`,
    adult: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('GET /catalog/movies', () => {
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  const originalTmdbApiKey = process.env.TMDB_API_KEY;
  let app: INestApplication;
  let moduleRef: TestingModule;
  let tmdbFetch: ReturnType<typeof vi.fn<TmdbFetch>>;

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = testSigningSecret;
    process.env.TMDB_API_KEY = tmdbApiKey;
    tmdbFetch = vi.fn<TmdbFetch>().mockResolvedValue(jsonResponse({ results: [] }));
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TMDB_FETCH)
      .useValue(tmdbFetch)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
      await moduleRef?.close();
    } finally {
      if (originalAuthJwtSecret === undefined) delete process.env.AUTH_JWT_SECRET;
      else process.env.AUTH_JWT_SECRET = originalAuthJwtSecret;
      if (originalTmdbApiKey === undefined) delete process.env.TMDB_API_KEY;
      else process.env.TMDB_API_KEY = originalTmdbApiKey;
    }
  });

  it.each([
    ['absent', '/catalog/movies'],
    ['repeated query parameters', '/catalog/movies?query=Cidade%20de%20Deus&query=Outro'],
    ['blank after trimming', '/catalog/movies?query=%20%20%20'],
    ['more than 100 characters after trimming', `/catalog/movies?query=%20${'x'.repeat(101)}%20`],
  ])('AC-2 returns the exact bad-query response for %s and does not call TMDB_FETCH', async (_description, path) => {
    tmdbFetch.mockClear();
    const response = request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${organizerToken()}`);

    await response.expect(400).expect(badQueryResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it('AC-3 requests the trimmed title and returns exactly the first ten normalized eligible provider movies', async () => {
    const results = Array.from({ length: 12 }, (_, index) =>
      providerMovie(index + 1, index === 1 ? { release_date: null, poster_path: null } : {}),
    );
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse({ results }));

    const response = await request(app.getHttpServer())
      .get('/catalog/movies')
      .query({ query: ' Cidade de Deus ' })
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(200);

    expect(response.body).toEqual(
      results.slice(0, 10).map(({ id, title, release_date, poster_path, overview }) => ({
        providerMovieId: id,
        title,
        releaseDate: release_date,
        posterPath: poster_path,
        overview,
      })),
    );
    expect(response.body.every((movie: unknown) => Object.keys(movie as object).sort().join(',') === 'overview,posterPath,providerMovieId,releaseDate,title')).toBe(true);
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
    const [input] = tmdbFetch.mock.calls[0];
    expect(new URL(String(input)).searchParams.get('query')).toBe('Cidade de Deus');
  });

  it('AC-3 excludes an adult result before validating its output-only fields and still fills ten eligible results', async () => {
    const eligibleResults = Array.from({ length: 10 }, (_, index) => providerMovie(index + 1));
    const results = [providerMovie(999, { adult: true, title: 8 }), ...eligibleResults];
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse({ results }));

    const response = await request(app.getHttpServer())
      .get('/catalog/movies')
      .query({ query: ' Cidade de Deus ' })
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(200);

    expect(response.body).toEqual(
      eligibleResults.map(({ id, title, release_date, poster_path, overview }) => ({
        providerMovieId: id,
        title,
        releaseDate: release_date,
        posterPath: poster_path,
        overview,
      })),
    );
  });

  it('AC-4 fixes all provider request values, uses an exact 5000 ms abort signal, and ignores caller override parameters', async () => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    try {
      await request(app.getHttpServer())
        .get('/catalog/movies')
        .query({ query: 'Cidade de Deus', language: 'en-US', region: 'US', include_adult: 'true', page: '9', api_key: 'leak' })
        .set('Authorization', `Bearer ${organizerToken()}`)
        .expect(200);

      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(tmdbFetch).toHaveBeenCalledTimes(1);
    const [input, init] = tmdbFetch.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.themoviedb.org/3/search/movie');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: tmdbApiKey,
      query: 'Cidade de Deus',
      language: 'pt-BR',
      region: 'BR',
      include_adult: 'false',
      page: '1',
    });
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(TMDB_HTTP_TIMEOUT_MS).toBe(5000);
  });

  it.each([
    ['a provider timeout', () => Promise.reject(new DOMException('timed out', 'AbortError'))],
    ['a non-success provider response', () => Promise.resolve(jsonResponse({ status_message: 'nope' }, 503))],
    ['invalid JSON', () => Promise.resolve(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }))],
    ['a malformed payload', () => Promise.resolve(jsonResponse({ results: [providerMovie(1, { title: 8 })] }))],
  ])('AC-5 returns the exact provider-unavailable response for %s', async (_description, response) => {
    tmdbFetch.mockReset();
    tmdbFetch.mockImplementationOnce(response as TmdbFetch);

    await request(app.getHttpServer())
      .get('/catalog/movies')
      .query({ query: 'Cidade de Deus' })
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(502)
      .expect(providerUnavailableResponse);
  });

  it.each([
    ['a missing bearer token', undefined, unauthorizedResponse],
    ['an invalid bearer token', 'Bearer invalid', unauthorizedResponse],
    ['a CUSTOMER token', `Bearer ${organizerToken(Role.CUSTOMER)}`, forbiddenResponse],
    ['a GATE token', `Bearer ${organizerToken(Role.GATE)}`, forbiddenResponse],
  ])('AC-5 preserves the exact access response for %s', async (_description, authorization, expectedResponse) => {
    tmdbFetch.mockClear();
    const response = request(app.getHttpServer()).get('/catalog/movies').query({ query: 'Cidade de Deus' });
    if (authorization !== undefined) response.set('Authorization', authorization);

    await response.expect(expectedResponse.statusCode).expect(expectedResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('AC-1 rejects AppModule construction when TMDB_API_KEY is %s and restores the prior test value', async (_description, tmdbApiKey) => {
    const previousTmdbApiKey = process.env.TMDB_API_KEY;
    let invalidModule: TestingModule | undefined;
    try {
      if (tmdbApiKey === undefined) delete process.env.TMDB_API_KEY;
      else process.env.TMDB_API_KEY = tmdbApiKey;

      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrowError(
        new Error('TMDB_API_KEY is required'),
      );
    } finally {
      await invalidModule?.close();
      if (previousTmdbApiKey === undefined) delete process.env.TMDB_API_KEY;
      else process.env.TMDB_API_KEY = previousTmdbApiKey;
    }
  });
});
