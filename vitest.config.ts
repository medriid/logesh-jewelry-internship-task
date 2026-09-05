import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // `server-only` resolves to an empty stub under the react-server condition,
  // so tests can import server modules directly while the real guard still
  // fires in any client bundle. It has to be set on the SSR resolver too:
  // node-environment tests load through the SSR pipeline, which keeps its own
  // condition list.
  ssr: { resolve: { conditions: ['react-server'] } },
  resolve: {
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
