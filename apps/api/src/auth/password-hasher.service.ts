import * as argon2 from 'argon2';

export class PasswordHasherService {
  async hash(plainTextPassword: string): Promise<string> {
    return argon2.hash(plainTextPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(encodedHash: string, plainTextPassword: string): Promise<boolean> {
    if (!encodedHash.startsWith('$argon2id$')) {
      return false;
    }

    try {
      return await argon2.verify(encodedHash, plainTextPassword);
    } catch {
      return false;
    }
  }
}
