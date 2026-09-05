/**
 * Build-time replacement for `@electric-sql/pglite` in production bundles.
 *
 * PGlite is an entire Postgres compiled to WebAssembly — ~17 MB of .wasm and
 * .data that a production deployment can never legally use, because
 * `assertDeploymentReady()` refuses to start a production server on any driver
 * but `postgres`. Shipping it to every serverless function is pure cold-start
 * tax on code that is unreachable by invariant.
 *
 * `next.config.ts` aliases the real package to this file for production builds
 * only. The throw below is defence in depth: if the invariant is ever weakened,
 * the failure is a clear message at construction rather than a confusing
 * missing-module error.
 */
export class PGlite {
  constructor() {
    throw new Error(
      'PGlite is not available in a production build. Production requires ' +
        'DATABASE_DRIVER=postgres — see docs/adr/0002-postgres-everywhere.md. ' +
        'If you meant to run PGlite, build with NODE_ENV=development.',
    );
  }
}
