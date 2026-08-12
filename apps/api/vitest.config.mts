import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['../../tests/api/**/*.spec.ts'],
    hookTimeout: 10_000,
  },
});
