import 'server-only';

import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

import { env } from '@/config/env';
import * as schema from './schema';

/**
 * Database access.
 *
 * Two drivers, one dialect. Both are Postgres, so there is no SQL that works in
 * development and fails in production — the reason this project does not use
 * SQLite locally. See docs/adr/0002-postgres-everywhere.md.
 *
 *   pglite   — Postgres compiled to WASM, running inside this process. A fresh
 *              clone runs `npm run dev` with no Docker, no cloud account, and no
 *              connection string. Tests get a throwaway database per file.
 *   postgres — a real server, over TCP. Neon in production.
 */

/**
 * Drizzle's shared Postgres surface, rather than a union of the two concrete
 * drivers.
 *
 * A union looks harmless and is not: TypeScript reduces a union of *overloaded*
 * methods to their last signature, so `db.delete(x).returning({ id })` reported
 * "Expected 0 arguments, but got 1" — the zero-arg `.returning()` overload was
 * the only one left standing. Both drivers extend `PgDatabase`, which carries
 * the full overload set once.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

type Handle = {
  db: Database;
  /** Kept so scripts and tests can shut the connection down deterministically. */
  close: () => Promise<void>;
};

/**
 * Next.js dev server re-evaluates modules on every hot reload. Without this the
 * process accumulates a new connection pool per save until Postgres refuses them.
 */
const globalForDb = globalThis as unknown as { __loupeDb?: Handle };

function createPglite(): Handle {
  // `memory://` gives each test file its own disposable database.
  const client = new PGlite(env.PGLITE_PATH);
  return {
    db: drizzlePglite(client, { schema, casing: 'snake_case' }),
    close: () => client.close(),
  };
}

function createPostgres(url: string): Handle {
  const client = postgres(url, {
    // Serverless functions are short-lived and numerous; a large per-instance
    // pool just exhausts the server's connection limit faster.
    max: env.NODE_ENV === 'production' ? 1 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Neon's pooled endpoint runs pgbouncer in transaction mode, which cannot
    // hold server-side prepared statements across a pooled connection.
    prepare: false,
    // Postgres notices are noise in application logs; real errors still throw.
    onnotice: () => {},
  });
  return {
    db: drizzlePostgres(client, { schema, casing: 'snake_case' }),
    close: () => client.end({ timeout: 5 }),
  };
}

function createHandle(): Handle {
  if (env.DATABASE_DRIVER === 'postgres') {
    // env.ts already guarantees DATABASE_URL is present for this driver.
    return createPostgres(env.DATABASE_URL as string);
  }
  return createPglite();
}

/**
 * The handle is created on first *use*, never on import.
 *
 * Two reasons, both of which showed up as real failures before this was lazy:
 *
 *   1. `next build` imports every route module to collect page data. With eager
 *      construction, building the app opened a database connection — which is
 *      wrong on a CI runner, and fatal once production builds alias PGlite away.
 *   2. On serverless, a route that never touches the database still paid for
 *      connection setup at cold start simply because something up its import
 *      graph re-exported `db`.
 */
let handle: Handle | null = null;

function getHandle(): Handle {
  if (handle) return handle;
  handle = globalForDb.__loupeDb ?? createHandle();
  if (env.NODE_ENV !== 'production') globalForDb.__loupeDb = handle;
  return handle;
}

/**
 * A lazy proxy, so call sites keep the plain `db.select(...)` shape rather than
 * threading `getDb()` through every function. The first property access is what
 * actually opens the connection.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const real = getHandle().db as unknown as Record<string | symbol, unknown>;
    const value = real[property];
    // Bind so Drizzle's internals keep their `this`.
    return typeof value === 'function' ? value.bind(real) : value;
  },
}) as Database;

/** No-op when nothing was ever opened — safe to call unconditionally. */
export async function closeDb(): Promise<void> {
  if (!handle) return;
  const current = handle;
  handle = null;
  delete globalForDb.__loupeDb;
  await current.close();
}

export { schema };
