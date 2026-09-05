/**
 * Build-time replacement for `drizzle-orm/pglite` in production bundles.
 *
 * Stubbing `@electric-sql/pglite` alone is not enough: Drizzle's PGlite driver
 * imports the package itself, and that node_modules-to-node_modules edge does
 * not go through the app's alias — so the real package (and its ~17 MB of
 * WebAssembly) came back in through the side door. Both edges have to be cut.
 */
export function drizzle(): never {
  throw new Error(
    'The PGlite driver is not available in a production build. Production ' +
      'requires DATABASE_DRIVER=postgres — see docs/adr/0002-postgres-everywhere.md.',
  );
}

/** Type-only in practice; erased at compile time. Present so the shape matches. */
export type PgliteDatabase<TSchema extends Record<string, unknown> = Record<string, never>> =
  Record<string, unknown> & { __schema?: TSchema };
