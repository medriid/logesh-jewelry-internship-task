import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '../../src/db/schema';

export type TestDatabase = PgliteDatabase<typeof schema>;

export type TestHarness = {
  db: TestDatabase;
  /** Raw SQL escape hatch, for asserting on things the ORM abstracts away. */
  raw: (query: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
};

/**
 * A disposable Postgres, created in memory, migrated from the real migration
 * files in ./drizzle.
 *
 * Two things this buys that a mocked repository would not:
 *   1. The CHECK constraints, generated columns, partial indexes and foreign
 *      keys are all *actually running*. A test that says "stock cannot go
 *      negative" is testing Postgres, not a stub that agrees with us.
 *   2. It exercises the same migration files production will run, so a broken
 *      migration fails in CI rather than on deploy.
 *
 * Cost is roughly 1–2s per database. Call once per test file, not per test.
 */
export async function createTestDatabase(): Promise<TestHarness> {
  const client = new PGlite(); // no path → ephemeral, in-memory
  const db = drizzle(client, { schema, casing: 'snake_case' });

  await migrate(db, { migrationsFolder: './drizzle' });

  return {
    db,
    raw: async (query) => {
      const result = await client.query(query);
      return result.rows as Record<string, unknown>[];
    },
    close: () => client.close(),
  };
}

/** Postgres SQLSTATE codes we assert on. */
export const PG = {
  CHECK_VIOLATION: '23514',
  UNIQUE_VIOLATION: '23505',
  FK_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
} as const;

export type DbViolation = {
  code: string;
  constraint: string | undefined;
  table: string | undefined;
  detail: string | undefined;
};

/**
 * Runs a write that is expected to fail, and returns the *Postgres* error rather
 * than the driver's wrapper.
 *
 * Drizzle rethrows query failures as `Error("Failed query: insert into …")` with
 * the real `PostgresError` on `.cause`, so a naive `rejects.toThrow(/constraint/)`
 * matches against the SQL text and passes for the wrong reason — or fails for the
 * wrong reason, which is how this helper came to exist. Unwrapping to the SQLSTATE
 * and constraint name makes the assertion say what it means.
 */
export async function violationOf(write: () => Promise<unknown>): Promise<DbViolation> {
  try {
    await write();
  } catch (error: unknown) {
    let current: unknown = error;
    while (
      current &&
      typeof current === 'object' &&
      'cause' in current &&
      (current as { cause?: unknown }).cause
    ) {
      current = (current as { cause: unknown }).cause;
    }

    const pg = current as Partial<DbViolation> | undefined;
    if (pg?.code) {
      return { code: pg.code, constraint: pg.constraint, table: pg.table, detail: pg.detail };
    }
    throw error; // not a database error — don't swallow it
  }

  throw new Error('Expected the database to reject this write, but it was accepted.');
}
