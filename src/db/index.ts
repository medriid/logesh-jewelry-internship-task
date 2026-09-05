import 'server-only';

import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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

export type Database = PgliteDatabase<typeof schema> | PostgresJsDatabase<typeof schema>;

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

const handle: Handle = globalForDb.__loupeDb ?? createHandle();
if (env.NODE_ENV !== 'production') globalForDb.__loupeDb = handle;

export const db: Database = handle.db;
export const closeDb = handle.close;
export { schema };
