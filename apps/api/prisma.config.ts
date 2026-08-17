import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Declaring a Prisma config disables Prisma's own .env loading, so every CLI
// command would otherwise need DATABASE_URL exported by hand. Loading it here
// keeps `prisma migrate deploy`, `prisma generate` and `pnpm db:seed` working
// from a clean checkout with nothing but `cp .env.example .env`.
for (const candidate of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(resolve(process.cwd(), candidate));
    break;
  } catch {
    // Try the next location; the shell may already provide the variables.
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
