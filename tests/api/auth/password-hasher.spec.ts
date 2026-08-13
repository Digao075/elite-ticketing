import { describe, expect, it } from 'vitest';

import { PasswordHasherService } from '../../../apps/api/src/auth/password-hasher.service';

const plainTextPassword = 'correct horse battery staple';

type ParsedArgon2idHash = {
  algorithm: string;
  parameters: string[];
  version: number;
};

function parseArgon2idHash(encodedHash: string): ParsedArgon2idHash | null {
  const match = encodedHash.match(/^\$(?<algorithm>argon2id)\$v=(?<version>\d+)\$(?<parameters>[^$]+)\$[^$]+\$[^$]+$/);

  if (!match?.groups) {
    return null;
  }

  return {
    algorithm: match.groups.algorithm,
    version: Number(match.groups.version),
    parameters: match.groups.parameters.split(',').sort(),
  };
}

describe('PasswordHasherService', () => {
  it('AC-1 returns a non-plaintext Argon2id hash with the approved parameters', async () => {
    const passwordHasher = new PasswordHasherService();

    const encodedHash = await passwordHasher.hash(plainTextPassword);

    expect(encodedHash).not.toBe(plainTextPassword);
    expect(parseArgon2idHash(encodedHash)).toEqual({
      algorithm: 'argon2id',
      version: 19,
      parameters: ['m=19456', 'p=1', 't=2'],
    });
  });

  it('AC-2 resolves true for the matching password and false for a different password', async () => {
    const passwordHasher = new PasswordHasherService();
    const encodedHash = await passwordHasher.hash(plainTextPassword);

    await expect(passwordHasher.verify(encodedHash, plainTextPassword)).resolves.toBe(true);
    await expect(passwordHasher.verify(encodedHash, 'wrong password')).resolves.toBe(false);
  });

  it.each([
    ['the malformed value specified by the criterion', 'not-an-argon2-hash'],
    ['an unsupported Argon2 variant', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
  ])('AC-3 resolves false without throwing for %s', async (_description, encodedHash) => {
    const passwordHasher = new PasswordHasherService();

    await expect(passwordHasher.verify(encodedHash, 'any password')).resolves.toBe(false);
  });

  it('AC-4 produces distinct hashes for the same password and verifies both', async () => {
    const passwordHasher = new PasswordHasherService();

    const firstHash = await passwordHasher.hash(plainTextPassword);
    const secondHash = await passwordHasher.hash(plainTextPassword);

    expect(firstHash).not.toBe(secondHash);
    await expect(passwordHasher.verify(firstHash, plainTextPassword)).resolves.toBe(true);
    await expect(passwordHasher.verify(secondHash, plainTextPassword)).resolves.toBe(true);
  });
});
