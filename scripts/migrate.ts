/**
 * Applies pending migrations from ./drizzle to whichever database the current
 * environment points at. Safe to run repeatedly — Drizzle tracks what it has
 * already applied in `drizzle.__drizzle_migrations`.
 *
 *   npm run db:migrate
 */
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { env } from '../src/config/env';
import { db, closeDb, type schema } from '../src/db';

const MIGRATIONS_FOLDER = './drizzle';

async function main() {
  const target =
    env.DATABASE_DRIVER === 'pglite' ? `PGlite (${env.PGLITE_PATH})` : 'Postgres (DATABASE_URL)';
  console.log(`→ migrating ${target}`);

  const started = Date.now();
  if (env.DATABASE_DRIVER === 'pglite') {
    await migratePglite(db as PgliteDatabase<typeof schema>, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
  } else {
    await migratePostgres(db as PostgresJsDatabase<typeof schema>, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
  }
  console.log(`✓ migrations applied in ${Date.now() - started}ms`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('✗ migration failed');
    console.error(error);
    await closeDb().catch(() => {});
    process.exit(1);
  });
