import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { closeDb, db } from '../../src/db';
import { GET } from '../../src/app/api/v1/health/route';
import { migrateAppDatabase } from '../helpers/database';

beforeAll(migrateAppDatabase);
afterAll(closeDb);

describe('database readiness', () => {
  it('reports healthy when all expected migrations are applied', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe('ok');
  });

  it('reports unavailable when only an older migration is recorded', async () => {
    await db.execute(sql`delete from drizzle.__drizzle_migrations
      where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('15');
  });

  it('reports unavailable when no migrations are recorded', async () => {
    await db.execute(sql`delete from drizzle.__drizzle_migrations`);
    expect((await GET()).status).toBe(503);
  });
});
