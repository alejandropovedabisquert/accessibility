import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Los tests comparten la BD en memoria y el pool de navegadores.
    fileParallelism: false,
  },
});
