export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 900;

export class JwtConfig {
  readonly secret: string;

  constructor() {
    const secret = process.env.AUTH_JWT_SECRET;
    if (typeof secret !== 'string' || secret.trim() === '') {
      throw new Error('AUTH_JWT_SECRET is required');
    }

    this.secret = secret;
  }
}
