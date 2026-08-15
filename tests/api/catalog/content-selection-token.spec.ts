import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ContentSelectionTokenService,
  type EventContentSelection,
  type SignedEventContentSelection,
} from '../../../apps/api/src/catalog/content-selection-token.service';

const secret = 'content-selection-test-secret';
const issuedAt = 1_893_456_000;
const expiresAt = issuedAt + 1_800;
const invalidTokenResponse = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'selectionToken is invalid or expired',
};

const canonicalContent: EventContentSelection = {
  providerMovieId: 550,
  title: 'Clube da Luta',
  releaseDate: '1999-10-15',
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
  overview: 'Um retrato da insônia.',
  runtimeMinutes: 139,
  genres: ['Drama', 'Thriller'],
  originalLanguage: 'en',
};

function serviceAt(epochSeconds: number): ContentSelectionTokenService {
  return new ContentSelectionTokenService(secret, () => new Date(epochSeconds * 1_000));
}

function signedToken(payload: unknown, signingSecret = secret): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return signedPayload(encodedPayload, signingSecret);
}

function signedPayload(encodedPayload: string, signingSecret = secret): string {
  const signature = createHmac('sha256', signingSecret)
    .update(`elite-ticketing:content-selection:v1.${encodedPayload}`, 'utf8')
    .digest('base64url');
  return `v1.${encodedPayload}.${signature}`;
}

function alterOnlyBase64urlPaddingBits(segment: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const lastCharacter = segment.at(-1);
  if (lastCharacter === undefined) throw new Error('Expected a non-empty base64url segment');

  const index = alphabet.indexOf(lastCharacter);
  if (index === -1) throw new Error('Expected a base64url segment');

  return `${segment.slice(0, -1)}${alphabet[index ^ 1]}`;
}

function expectInvalidToken(action: () => unknown): void {
  try {
    action();
    throw new Error('Expected verify to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual(invalidTokenResponse);
  }
}

describe('ContentSelectionTokenService', () => {
  it('AC-2 issues the exact v1 HMAC token and verifies canonical content repeatedly before expiry', () => {
    const token = serviceAt(issuedAt).issue(canonicalContent);
    const [prefix, payload, signature] = token.split('.');
    const expected: SignedEventContentSelection = { ...canonicalContent, version: 1, issuedAt, expiresAt };

    expect([prefix, payload, signature]).toHaveLength(3);
    expect(prefix).toBe('v1');
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual(expected);
    expect(signature).toBe(
      createHmac('sha256', secret).update(`elite-ticketing:content-selection:v1.${payload}`, 'utf8').digest('base64url'),
    );
    expect(serviceAt(expiresAt - 1).verify(token)).toEqual(expected);
    expect(serviceAt(expiresAt - 1).verify(token)).toEqual(expected);
  });

  it('AC-2 rejects a token at its exact expiry instant', () => {
    expectInvalidToken(() => serviceAt(expiresAt).verify(serviceAt(issuedAt).issue(canonicalContent)));
  });

  it.each([
    ['an absent token', undefined],
    ['a blank token', '   '],
    ['a changed payload', `${signedToken({ ...canonicalContent, version: 1, issuedAt, expiresAt }).replace(/.$/, 'A')}`],
    ['a changed signature', `${signedToken({ ...canonicalContent, version: 1, issuedAt, expiresAt }).slice(0, -1)}A`],
    ['a non-base64url payload segment with a matching signature', signedPayload('@@@')],
    ['invalid JSON with a matching signature', signedPayload(Buffer.from('{').toString('base64url'))],
    ['a wrong segment prefix', signedToken({ ...canonicalContent, version: 1, issuedAt, expiresAt }).replace(/^v1\./, 'v2.')],
  ])('AC-3 returns the exact indistinguishable invalid-token response for %s', (_description, token) => {
    expectInvalidToken(() => serviceAt(issuedAt).verify(token as string));
  });

  it('AC-3 rejects a textually altered signature even when permissive base64url decoding yields the canonical digest bytes', () => {
    const token = serviceAt(issuedAt).issue(canonicalContent);
    const [prefix, payload, signature] = token.split('.');
    const alteredSignature = alterOnlyBase64urlPaddingBits(signature);

    expect(Buffer.from(alteredSignature, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
    expectInvalidToken(() => serviceAt(issuedAt).verify(`${prefix}.${payload}.${alteredSignature}`));
  });

  it('AC-3 rejects a base64url payload mutation while retaining the original signature segment', () => {
    const token = serviceAt(issuedAt).issue(canonicalContent);
    const [prefix, payload, signature] = token.split('.');
    const alteredPayload = alterOnlyBase64urlPaddingBits(payload);

    expect(alteredPayload).not.toBe(payload);
    expectInvalidToken(() => serviceAt(issuedAt).verify(`${prefix}.${alteredPayload}.${signature}`));
  });

  it('AC-3 rejects a token with an extra dot-separated segment', () => {
    expectInvalidToken(() => serviceAt(issuedAt).verify(`${serviceAt(issuedAt).issue(canonicalContent)}.extra`));
  });

  it.each([
    ['payload version is not 1', { version: 2 }],
    ['issuedAt is later than the verification clock', { issuedAt: issuedAt + 1 }],
    ['expiry is not 1800 seconds after issue', { expiresAt: expiresAt - 1 }],
    ['a required payload field is missing', { originalLanguage: undefined }],
    ['an extra payload field exists', { unexpected: true }],
    ['runtime is zero', { runtimeMinutes: 0 }],
    ['runtime is not an integer', { runtimeMinutes: 139.5 }],
    ['genres contains a blank value', { genres: ['Drama', ''] }],
    ['original language is blank', { originalLanguage: '' }],
  ])('AC-3 rejects a correctly signed token when %s', (_description, override) => {
    const payload = { ...canonicalContent, version: 1, issuedAt, expiresAt, ...override };
    expectInvalidToken(() => serviceAt(issuedAt).verify(signedToken(payload)));
  });
});
