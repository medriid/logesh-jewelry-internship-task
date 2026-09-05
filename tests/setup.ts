/**
 * Global test setup.
 *
 * Pinned before any module reads it, because src/config/env.ts parses the
 * environment at import time and would otherwise apply development defaults.
 * Written via Object.assign because @types/node declares NODE_ENV read-only.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_DRIVER: 'pglite',
  PGLITE_PATH: 'memory://',
  // Deliberately not prefixed "test" — env.ts rejects placeholder-looking
  // secrets, and it rejected this fixture the first time round.
  APP_SECRET: 'k9Xq2mVr7bNw4pLz8HcT3yFd6JsA5gEu1QoW0iRxZnMv',
  LOG_LEVEL: 'fatal',

  // Argon2 at production cost turns every login test into a 200ms wait. These
  // tests assert on the protocol — a correct password verifies, a wrong one does
  // not — while the cost factor itself has its own dedicated test.
  ARGON2_MEMORY_KIB: '19456',
  ARGON2_ITERATIONS: '2',
});
