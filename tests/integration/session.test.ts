import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db, closeDb } from '../../src/db';
import { adminUsers, sessions } from '../../src/db/schema';
import { hashPassword } from '../../src/lib/auth/password';
import {
  createSession,
  listSessionsForUser,
  pruneExpiredSessions,
  revokeAllSessionsForUser,
  revokeSession,
  validateSession,
} from '../../src/lib/auth/session';
import { hashToken } from '../../src/lib/auth/tokens';
import { migrateAppDatabase } from '../helpers/database';

let userId: string;

beforeAll(async () => {
  await migrateAppDatabase();
  const [user] = await db
    .insert(adminUsers)
    .values({
      email: 'owner@loupe.jewelry',
      name: 'Owner',
      passwordHash: await hashPassword('a sufficiently long password'),
      role: 'OWNER',
      status: 'ACTIVE',
    })
    .returning({ id: adminUsers.id });
  userId = user!.id;
});

afterAll(async () => closeDb());

describe('session issuance', () => {
  it('never stores the token — only its digest', async () => {
    const { token } = await createSession(userId);

    const stored = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, hashToken(token)));
    expect(stored).toHaveLength(1);

    // The whole argument for opaque sessions: a dump of this table is useless.
    const anyRowContainsToken = (await db.select().from(sessions)).some((row) =>
      JSON.stringify(row).includes(token),
    );
    expect(anyRowContainsToken).toBe(false);
  });

  it('stores the IP as a keyed hash, never the address', async () => {
    await createSession(userId, { ip: '203.0.113.42', userAgent: 'Mozilla/5.0' });
    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
    for (const row of rows) expect(row.ipHash ?? '').not.toContain('203.0.113');
  });

  it('resolves a valid token to its user and role', async () => {
    const { token } = await createSession(userId);
    const session = await validateSession(token);
    expect(session?.user).toMatchObject({ id: userId, role: 'OWNER' });
  });

  it('sets an absolute deadline beyond the idle one', async () => {
    const { token } = await createSession(userId);
    const session = await validateSession(token);
    expect(session!.absoluteExpiresAt.getTime()).toBeGreaterThan(session!.expiresAt.getTime());
  });
});

describe('session rejection', () => {
  it.each([
    ['no token', undefined],
    ['empty token', ''],
    ['a token that was never issued', 'Zm9yZ2VkLXRva2VuLXRoYXQtd2FzLW5ldmVyLWlzc3VlZA'],
  ])('returns null for %s', async (_label, token) => {
    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('rejects an expired session', async () => {
    const { token } = await createSession(userId);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.id, hashToken(token)));

    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('rejects once the absolute deadline passes, even if idle expiry is fresh', async () => {
    // The point of the second clock: a stolen cookie cannot be kept alive
    // forever just by continuing to use it.
    const { token } = await createSession(userId);
    await db
      .update(sessions)
      .set({
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() - 1_000),
      })
      .where(eq(sessions.id, hashToken(token)));

    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('rejects a revoked session immediately', async () => {
    const { token } = await createSession(userId);
    await revokeSession(hashToken(token));
    await expect(validateSession(token)).resolves.toBeNull();
  });

  it('rejects sessions of a suspended account', async () => {
    const { token } = await createSession(userId);
    await db.update(adminUsers).set({ status: 'SUSPENDED' }).where(eq(adminUsers.id, userId));
    await expect(validateSession(token)).resolves.toBeNull();
    await db.update(adminUsers).set({ status: 'ACTIVE' }).where(eq(adminUsers.id, userId));
  });

  it('rejects every session issued before a password change', async () => {
    // "Change my password" has to mean "log the attacker out", without hunting
    // down each session individually.
    const { token } = await createSession(userId);
    await expect(validateSession(token)).resolves.not.toBeNull();

    await db
      .update(adminUsers)
      .set({ passwordChangedAt: new Date(Date.now() + 1_000) })
      .where(eq(adminUsers.id, userId));

    await expect(validateSession(token)).resolves.toBeNull();

    await db
      .update(adminUsers)
      .set({ passwordChangedAt: new Date(Date.now() - 60_000) })
      .where(eq(adminUsers.id, userId));
  });
});

describe('revocation and cleanup', () => {
  it('revokes every active session for a user at once', async () => {
    const issued = await Promise.all([
      createSession(userId),
      createSession(userId),
      createSession(userId),
    ]);
    const count = await revokeAllSessionsForUser(userId);
    expect(count).toBeGreaterThanOrEqual(3);

    for (const { token } of issued) {
      await expect(validateSession(token)).resolves.toBeNull();
    }
  });

  it('lists only live sessions, for an "active sessions" screen', async () => {
    await revokeAllSessionsForUser(userId);
    await createSession(userId, { userAgent: 'Firefox' });
    await createSession(userId, { userAgent: 'Safari' });

    const live = await listSessionsForUser(userId);
    expect(live).toHaveLength(2);
    expect(live.map((s) => s.userAgent).sort()).toEqual(['Firefox', 'Safari']);
  });

  it('prunes long-dead rows but keeps live ones', async () => {
    const { token } = await createSession(userId);
    const stale = await createSession(userId);

    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ absoluteExpiresAt: longAgo })
      .where(eq(sessions.id, hashToken(stale.token)));

    expect(await pruneExpiredSessions()).toBeGreaterThanOrEqual(1);
    await expect(validateSession(token)).resolves.not.toBeNull();
  });
});
