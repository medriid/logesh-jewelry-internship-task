import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Resolve `server-only` to its empty stub so tests can import server modules
    // directly, while the real guard still fires in any client bundle.
    conditions: ['react-server'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests each boot an isolated in-memory Postgres (PGlite).
    // Running files serially keeps memory sane and ordering deterministic.
    fileParallelism: false,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/server/**', 'src/db/**', 'src/config/**'],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
