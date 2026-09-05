import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are always generated against the Postgres dialect, whether the
 * local runtime is PGlite (dev/test) or Neon (production). Same dialect, same
 * SQL, no "works on my machine" drift. See docs/adr/0002-postgres-everywhere.md.
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/auric',
  },
  strict: true,
  verbose: true,
  casing: 'snake_case',
});
