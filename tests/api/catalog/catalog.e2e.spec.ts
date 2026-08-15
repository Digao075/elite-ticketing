import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../apps/api/src/app.module';
import { CONTENT_SELECTION_CLOCK } from '../../../apps/api/src/catalog/content-selection-token.service';
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

describe('GET /catalog/movies/popular', () => {
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

  it('AC-1 returns exactly the first ten popular summaries in provider order with T-007 mapping and null preservation', async () => {
    const results = Array.from({ length: 12 }, (_, index) =>
      providerMovie(index + 1, index === 1 ? { release_date: null, poster_path: null } : {}),
    );
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse({ results }));

    const response = await request(app.getHttpServer())
      .get('/catalog/movies/popular')
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
  });

  it('AC-2 makes one fixed popular request, ignores caller query parameters, excludes adult results, and then limits to ten', async () => {
    const eligibleResults = Array.from({ length: 10 }, (_, index) => providerMovie(index + 1));
    const results = [providerMovie(999, { adult: true }), ...eligibleResults, providerMovie(1000)];
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse({ results }));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    try {
      const response = await request(app.getHttpServer())
        .get('/catalog/movies/popular')
        .query({ page: '9', language: 'en-US', region: 'US', include_adult: 'true', api_key: 'leak', limit: '99', query: 'ignored' })
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
      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(tmdbFetch).toHaveBeenCalledTimes(1);
    const [input, init] = tmdbFetch.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.themoviedb.org/3/movie/popular');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: tmdbApiKey,
      language: 'pt-BR',
      region: 'BR',
      page: '1',
    });
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(TMDB_HTTP_TIMEOUT_MS).toBe(5000);
  });

  it.each([
    ['a missing bearer token', undefined, unauthorizedResponse],
    ['an invalid bearer token', 'Bearer invalid', unauthorizedResponse],
    ['a CUSTOMER token', `Bearer ${organizerToken(Role.CUSTOMER)}`, forbiddenResponse],
    ['a GATE token', `Bearer ${organizerToken(Role.GATE)}`, forbiddenResponse],
  ])('AC-3 preserves the exact access response for %s and does not call TMDB_FETCH', async (_description, authorization, expectedResponse) => {
    tmdbFetch.mockClear();
    const response = request(app.getHttpServer()).get('/catalog/movies/popular');
    if (authorization !== undefined) response.set('Authorization', authorization);

    await response.expect(expectedResponse.statusCode).expect(expectedResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a provider timeout', () => Promise.reject(new DOMException('timed out', 'AbortError'))],
    ['a non-success provider response', () => Promise.resolve(jsonResponse({ status_message: 'secret provider failure' }, 503))],
    ['invalid JSON', () => Promise.resolve(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }))],
    ['a non-object body', () => Promise.resolve(jsonResponse([]))],
    ['a missing results field', () => Promise.resolve(jsonResponse({}))],
    ['a non-array results field', () => Promise.resolve(jsonResponse({ results: {} }))],
    ['a missing adult field', () => Promise.resolve(jsonResponse({ results: [providerMovie(1, { adult: undefined })] }))],
    ['a non-boolean adult field', () => Promise.resolve(jsonResponse({ results: [providerMovie(1, { adult: 'false' })] }))],
    ['an invalid required summary field in the first ten eligible results', () =>
      Promise.resolve(jsonResponse({ results: [providerMovie(1, { title: 8 })] }))],
  ])('AC-4 returns the exact provider-unavailable response without provider data for %s', async (_description, providerResponse) => {
    tmdbFetch.mockReset();
    tmdbFetch.mockImplementationOnce(providerResponse as TmdbFetch);

    await request(app.getHttpServer())
      .get('/catalog/movies/popular')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(502)
      .expect(providerUnavailableResponse);
  });
});

function providerMovieDetail(id: number, overrides: Record<string, unknown> = {}) {
  return {
    ...providerMovie(id),
    runtime: 121,
    genres: [{ name: 'Drama' }, { name: 'Crime' }],
    backdrop_path: null,
    original_language: 'en',
    ...overrides,
  };
}

const invalidProviderMovieIdResponse = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'providerMovieId must be a positive 32-bit integer',
};

const unschedulableSelectionResponse = {
  statusCode: 422,
  error: 'Unprocessable Entity',
  message: 'Selected movie must have a positive runtime',
};

describe('GET /catalog/movies/:providerMovieId', () => {
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  const originalTmdbApiKey = process.env.TMDB_API_KEY;
  let app: INestApplication;
  let moduleRef: TestingModule;
  let tmdbFetch: ReturnType<typeof vi.fn<TmdbFetch>>;

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = testSigningSecret;
    process.env.TMDB_API_KEY = tmdbApiKey;
    tmdbFetch = vi.fn<TmdbFetch>().mockResolvedValue(jsonResponse(providerMovieDetail(550)));
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

  it('AC-1 returns exactly the canonical detail DTO in provider genre order', async () => {
    const detail = providerMovieDetail(550, { release_date: null, poster_path: null, runtime: null });
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse(detail));

    const response = await request(app.getHttpServer())
      .get('/catalog/movies/550')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      providerMovieId: 550,
      title: detail.title,
      releaseDate: null,
      posterPath: null,
      overview: detail.overview,
      runtimeMinutes: null,
      genres: ['Drama', 'Crime'],
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'genres',
      'overview',
      'posterPath',
      'providerMovieId',
      'releaseDate',
      'runtimeMinutes',
      'title',
    ]);
  });

  it('AC-1 preserves zero runtime and an empty provider genres array', async () => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse(providerMovieDetail(1, { runtime: 0, genres: [] })));

    await request(app.getHttpServer())
      .get('/catalog/movies/1')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(200)
      .expect({
        providerMovieId: 1,
        title: 'Movie 1',
        releaseDate: '2002-08-30',
        posterPath: '/poster-1.jpg',
        overview: 'Overview 1',
        runtimeMinutes: 0,
        genres: [],
      });
  });

  it.each([
    ['non-decimal text', 'abc'],
    ['a decimal point', '1.5'],
    ['a sign', '-1'],
    ['zero', '0'],
    ['a value above the signed 32-bit maximum', '2147483648'],
  ])('AC-2 returns the exact invalid-ID response for %s without calling TMDB_FETCH', async (_description, providerMovieId) => {
    tmdbFetch.mockClear();

    await request(app.getHttpServer())
      .get(`/catalog/movies/${providerMovieId}`)
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(400)
      .expect(invalidProviderMovieIdResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it('AC-2 keeps movies/popular on the T-008 handler rather than detail validation', async () => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

    await request(app.getHttpServer())
      .get('/catalog/movies/popular')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(200)
      .expect([]);
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(tmdbFetch.mock.calls[0][0])).pathname).toBe('/3/movie/popular');
  });

  it('AC-3 makes one fixed detail request with an exact 5000 ms abort signal and ignores caller overrides', async () => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse(providerMovieDetail(2147483647)));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    try {
      await request(app.getHttpServer())
        .get('/catalog/movies/2147483647')
        .query({ language: 'en-US', region: 'US', include_adult: 'true', api_key: 'leak' })
        .set('Authorization', `Bearer ${organizerToken()}`)
        .expect(200);
      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(tmdbFetch).toHaveBeenCalledTimes(1);
    const [input, init] = tmdbFetch.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.themoviedb.org/3/movie/2147483647');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: tmdbApiKey,
      language: 'pt-BR',
      region: 'BR',
      include_adult: 'false',
    });
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(TMDB_HTTP_TIMEOUT_MS).toBe(5000);
  });

  it.each([
    ['a missing bearer token', undefined, unauthorizedResponse],
    ['an invalid bearer token', 'Bearer invalid', unauthorizedResponse],
    ['a CUSTOMER token', `Bearer ${organizerToken(Role.CUSTOMER)}`, forbiddenResponse],
    ['a GATE token', `Bearer ${organizerToken(Role.GATE)}`, forbiddenResponse],
  ])('AC-4 returns the exact denied response for %s without calling TMDB_FETCH', async (_description, authorization, expectedResponse) => {
    tmdbFetch.mockClear();
    const response = request(app.getHttpServer()).get('/catalog/movies/550');
    if (authorization !== undefined) response.set('Authorization', authorization);

    await response.expect(expectedResponse.statusCode).expect(expectedResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a timeout', () => Promise.reject(new DOMException('timed out', 'AbortError'))],
    ['a non-2xx provider response', () => Promise.resolve(jsonResponse({ status_message: 'provider secret' }, 503))],
    ['invalid JSON', () => Promise.resolve(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }))],
    ['a non-object response body', () => Promise.resolve(jsonResponse([]))],
    ['an ID mismatch', () => Promise.resolve(jsonResponse(providerMovieDetail(551)))],
    ['adult set to true', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { adult: true })))],
    ['a missing title', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { title: undefined })))],
    ['a non-string release date', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { release_date: 7 })))],
    ['a negative runtime', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { runtime: -1 })))],
    ['a non-integer runtime', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { runtime: 1.5 })))],
    ['a genre without a non-empty name', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { genres: [{ name: '' }] })))],
  ])('AC-5 returns the exact provider-unavailable response without provider data for %s', async (_description, providerResponse) => {
    tmdbFetch.mockReset();
    tmdbFetch.mockImplementationOnce(providerResponse as TmdbFetch);

    await request(app.getHttpServer())
      .get('/catalog/movies/550')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(502)
      .expect(providerUnavailableResponse);
  });
});

describe('POST /catalog/movies/:providerMovieId/selection', () => {
  const originalAuthJwtSecret = process.env.AUTH_JWT_SECRET;
  const originalTmdbApiKey = process.env.TMDB_API_KEY;
  const originalContentSelectionSecret = process.env.CONTENT_SELECTION_SECRET;
  let app: INestApplication;
  let moduleRef: TestingModule;
  let tmdbFetch: ReturnType<typeof vi.fn<TmdbFetch>>;

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET = testSigningSecret;
    process.env.TMDB_API_KEY = tmdbApiKey;
    process.env.CONTENT_SELECTION_SECRET = 'catalog-selection-e2e-secret';
    tmdbFetch = vi.fn<TmdbFetch>().mockResolvedValue(jsonResponse(providerMovieDetail(550)));
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TMDB_FETCH)
      .useValue(tmdbFetch)
      .overrideProvider(CONTENT_SELECTION_CLOCK)
      .useValue(() => new Date('2030-01-01T00:00:00.000Z'))
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
      if (originalContentSelectionSecret === undefined) delete process.env.CONTENT_SELECTION_SECRET;
      else process.env.CONTENT_SELECTION_SECRET = originalContentSelectionSecret;
    }
  });

  it('AC-1 issues one normalized selection with the exact response, fixed provider request, and five-second timeout', async () => {
    const detail = providerMovieDetail(550, { backdrop_path: '/backdrop.jpg', original_language: 'en' });
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse(detail));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    try {
      const response = await request(app.getHttpServer())
        .post('/catalog/movies/550/selection')
        .query({ language: 'en-US', region: 'US', include_adult: 'true', api_key: 'leak' })
        .set('Authorization', `Bearer ${organizerToken()}`)
        .expect(200);

      expect(response.body).toEqual({ selectionToken: expect.any(String), expiresIn: 1800 });
      expect(response.body.selectionToken).not.toHaveLength(0);
      expect(JSON.parse(Buffer.from(response.body.selectionToken.split('.')[1], 'base64url').toString('utf8'))).toEqual({
        providerMovieId: 550,
        title: detail.title,
        releaseDate: detail.release_date,
        posterPath: detail.poster_path,
        backdropPath: detail.backdrop_path,
        overview: detail.overview,
        runtimeMinutes: detail.runtime,
        genres: detail.genres.map(({ name }) => name),
        originalLanguage: detail.original_language,
        version: 1,
        issuedAt: 1_893_456_000,
        expiresAt: 1_893_457_800,
      });
      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(tmdbFetch).toHaveBeenCalledTimes(1);
    const [input, init] = tmdbFetch.mock.calls[0];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe('https://api.themoviedb.org/3/movie/550');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api_key: tmdbApiKey,
      language: 'pt-BR',
      region: 'BR',
      include_adult: 'false',
    });
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['runtime is null', providerMovieDetail(550, { runtime: null, backdrop_path: null, original_language: 'en' })],
    ['runtime is zero', providerMovieDetail(550, { runtime: 0, backdrop_path: null, original_language: 'en' })],
  ])('AC-4 returns the exact unschedulable response when %s', async (_description, detail) => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse(detail));

    const response = await request(app.getHttpServer())
      .post('/catalog/movies/550/selection')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(422)
      .expect(unschedulableSelectionResponse);

    expect(response.body).not.toHaveProperty('selectionToken');
  });

  it.each([
    ['a timeout', () => Promise.reject(new DOMException('timed out', 'AbortError'))],
    ['a non-2xx response', () => Promise.resolve(jsonResponse({}, 503))],
    ['invalid JSON', () => Promise.resolve(new Response('{', { status: 200 }))],
    ['an ID mismatch', () => Promise.resolve(jsonResponse(providerMovieDetail(551)))],
    ['adult content', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { adult: true })) )],
    ['a malformed original language with a valid backdrop path', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { original_language: '', backdrop_path: '/backdrop.jpg' })) )],
    ['an invalid backdrop path with a valid original language', () => Promise.resolve(jsonResponse(providerMovieDetail(550, { backdrop_path: 4, original_language: 'en' })) )],
  ])('AC-4 returns the exact unavailable response for %s', async (_description, providerResponse) => {
    tmdbFetch.mockReset();
    tmdbFetch.mockImplementationOnce(providerResponse as TmdbFetch);

    await request(app.getHttpServer())
      .post('/catalog/movies/550/selection')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(502)
      .expect(providerUnavailableResponse);
  });

  it.each(['abc', '-1', '0', '1.5', '2147483648'])('AC-4 rejects invalid provider IDs and does not call TMDB_FETCH: %s', async (id) => {
    tmdbFetch.mockClear();
    await request(app.getHttpServer())
      .post(`/catalog/movies/${id}/selection`)
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(400)
      .expect(invalidProviderMovieIdResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing token', undefined, unauthorizedResponse],
    ['an invalid token', 'Bearer invalid', unauthorizedResponse],
    ['a CUSTOMER token', `Bearer ${organizerToken(Role.CUSTOMER)}`, forbiddenResponse],
    ['a GATE token', `Bearer ${organizerToken(Role.GATE)}`, forbiddenResponse],
  ])('AC-4 returns the exact access denial for %s without calling TMDB_FETCH', async (_description, authorization, expectedResponse) => {
    tmdbFetch.mockClear();
    const response = request(app.getHttpServer()).post('/catalog/movies/550/selection');
    if (authorization !== undefined) response.set('Authorization', authorization);
    await response.expect(expectedResponse.statusCode).expect(expectedResponse);
    expect(tmdbFetch).not.toHaveBeenCalled();
  });

  it('AC-5 keeps the T-009 detail response at exactly seven public keys with no selection fields', async () => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValueOnce(jsonResponse(providerMovieDetail(550)));
    const response = await request(app.getHttpServer())
      .get('/catalog/movies/550')
      .set('Authorization', `Bearer ${organizerToken()}`)
      .expect(200);

    expect(Object.keys(response.body).sort()).toEqual([
      'genres', 'overview', 'posterPath', 'providerMovieId', 'releaseDate', 'runtimeMinutes', 'title',
    ]);
    expect(response.body).not.toHaveProperty('selectionToken');
    expect(response.body).not.toHaveProperty('expiresIn');
    expect(response.body).not.toHaveProperty('backdropPath');
    expect(response.body).not.toHaveProperty('originalLanguage');
  });

  it.each([undefined, '', '   '])('AC-5 rejects AppModule construction when CONTENT_SELECTION_SECRET is %j', async (selectionSecret) => {
    const previousSecret = process.env.CONTENT_SELECTION_SECRET;
    try {
      if (selectionSecret === undefined) delete process.env.CONTENT_SELECTION_SECRET;
      else process.env.CONTENT_SELECTION_SECRET = selectionSecret;
      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrowError(
        new Error('CONTENT_SELECTION_SECRET is required'),
      );
    } finally {
      if (previousSecret === undefined) delete process.env.CONTENT_SELECTION_SECRET;
      else process.env.CONTENT_SELECTION_SECRET = previousSecret;
    }
  });
});
