import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

// Nest does not read .env on its own. Loading it here means `pnpm dev` works
// straight after `cp .env.example .env`, with no exported variables.
for (const candidate of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(resolve(process.cwd(), candidate));
    break;
  } catch {
    // Try the next location; the shell may already provide the variables.
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The web app is served from a different origin in development, so the
  // browser needs an explicit allowance. Kept to an allowlist rather than `*`
  // so the API does not accept credentialed calls from arbitrary pages.
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  await app.listen(process.env.API_PORT ?? 3000);
}

void bootstrap();
