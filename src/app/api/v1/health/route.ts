import { sql } from 'drizzle-orm';

import journal from '../../../../../drizzle/meta/_journal.json';
import { defineRoute } from '@/lib/http/handler';

import { env, isProduction } from '@/config/env';
import { db } from '@/db';
import { ok } from '@/lib/http/responses';
import { problem, problemResponse } from '@/lib/http/problem';

/**
 * Liveness and readiness.
 *
 * "Is the process up" is nearly useless on its own — a process with an
 * unreachable database happily returns 200 while every real request fails. This
 * checks the two things that actually determine whether the API can serve
 * traffic: the database answers, and the migrations that the running code
 * expects have been applied.
 *
 * That second check is the one that catches the classic deploy failure: new
 * code shipped, migration forgotten, every write failing on a missing column.
 */

// Never prerendered, never cached — a cached health check is a lie.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Check = { ok: boolean; latencyMs: number; detail?: string };

async function timed(fn: () => Promise<string | undefined>): Promise<Check> {
  const started = performance.now();
  try {
    const detail = await fn();
    const check: Check = { ok: true, latencyMs: Math.round(performance.now() - started) };
    return detail === undefined ? check : { ...check, detail };
  } catch (error: unknown) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      // A driver error can carry the host and database name. Fine locally,
      // reconnaissance in production.
      detail: isProduction ? 'unavailable' : error instanceof Error ? error.message : 'unknown',
    };
  }
}

export async function GET() {
  const database = await timed(async () => {
    await db.execute(sql`select 1`);
    return undefined;
  });

  const migrations = await timed(async () => {
    const result = (await db.execute(
      sql`select count(*)::int as applied,
                 coalesce(max(created_at), 0)::bigint as latest
            from drizzle.__drizzle_migrations`,
    )) as unknown;
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as {
      applied: number;
      latest: string | number;
    }[];
    const row = rows[0];
    const latestExpected = Math.max(...journal.entries.map((entry) => entry.when));
    if (!row || row.applied < journal.entries.length || Number(row.latest) < latestExpected) {
      throw new Error('pending migrations');
    }
    return `${row.applied} applied`;
  });

  const healthy = database.ok && migrations.ok;

  const body = {
    status: healthy ? ('ok' as const) : ('degraded' as const),
    // Which database this instance is actually talking to. The single most
    // common production surprise is discovering it is not the one you meant.
    driver: env.DATABASE_DRIVER,
    environment: env.NODE_ENV,
    checks: { database, migrations },
    timestamp: new Date().toISOString(),
  };

  if (!healthy) {
    return problemResponse(
      problem('service-unavailable', {
        detail: !database.ok
          ? 'The database is not reachable.'
          : 'Pending migrations — the running code expects a newer schema.',
        retryAfterSeconds: 15,
      }),
    );
  }

  return ok(body);
}

// Explicit export routes preflight through the shared CORS policy.
export const OPTIONS = defineRoute(
  { auth: 'public' },
  async () => new Response(null, { status: 204 }),
);
