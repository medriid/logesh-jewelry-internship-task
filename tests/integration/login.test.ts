import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { closeDb, db } from '../../src/db';
import { adminUsers, auditLogs, sessions } from '../../src/db/schema';
import { hashPassword } from '../../src/lib/auth/password';
import { validateSession } from '../../src/lib/auth/session';
import { login } from '../../src/server/services/auth';
import { migrateAppDatabase } from '../helpers/database';

const PASSWORD = 'a sufficiently long password';
const CTX = { requestId: 'test-request', ip: '203.0.113.7', userAgent: 'vitest' };

let userId: string;

beforeAll(async () => {
  await migrateAppDatabase();
  const [user] = await db
    .insert(adminUsers)
    .values({
      email: 'Owner@Loupe.Jewelry', // mixed case on purpose
      name: 'Store Owner',
      passwordHash: await hashPassword(PASSWORD),
      role: 'OWNER',
      status: 'ACTIVE',
    })
    .returning({ id: adminUsers.id });
  userId = user!.id;
});

beforeEach(async () => {
  await db
    .update(adminUsers)
    .set({ failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' })
    .where(eq(adminUsers.id, userId));
});

afterAll(async () => closeDb());

describe('login', () => {
  /**
   * Regression test for a deadlock.
   *
   * `login()` runs its updates in a transaction and then issues the session.
   * When session creation used the module-level `db` instead of the
   * transaction handle, the transaction held the only connection while the
   * insert queued behind it, and the request hung forever. PGlite has one
   * connection and production runs `max: 1`, so it hung in both.
   *
   * A test that merely awaits `login()` catches this: it never resolves.
   */
  it('completes without deadlocking on the transaction', async () => {
    const result = await Promise.race([
      login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('login deadlocked')), 10_000),
      ),
    ]);
    expect(result.ok).toBe(true);
  });

  it('matches the email case-insensitively', async () => {
    const result = await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    expect(result.ok).toBe(true);
  });

  it('issues a session that immediately validates', async () => {
    const result = await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    if (!result.ok) throw new Error('expected success');
    const session = await validateSession(result.value.session.token);
    expect(session?.user.id).toBe(userId);
  });

  it('writes an audit row in the same transaction', async () => {
    await db.delete(auditLogs);
    await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);

    const [entry] = await db.select().from(auditLogs);
    expect(entry?.action).toBe('session.created');
    expect(entry?.actorId).toBe(userId);
    // The IP is hashed on the way in, never stored raw.
    expect(entry?.ipHash).not.toContain('203.0.113');
  });

  it('resets the failure counter on success', async () => {
    await db.update(adminUsers).set({ failedLoginAttempts: 3 }).where(eq(adminUsers.id, userId));
    await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId));
    expect(user?.failedLoginAttempts).toBe(0);
  });
});

describe('login failures are indistinguishable', () => {
  it.each([
    ['wrong password', { email: 'owner@loupe.jewelry', password: 'the wrong password' }],
    ['unknown address', { email: 'nobody@example.com', password: 'the wrong password' }],
  ])('%s returns the same reason', async (_label, input) => {
    const result = await login(input, CTX);
    expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
  });

  it('a suspended account fails identically, even with the right password', async () => {
    await db.update(adminUsers).set({ status: 'SUSPENDED' }).where(eq(adminUsers.id, userId));
    const result = await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
  });

  it('spends comparable time on an unknown address', async () => {
    // Without the dummy-hash path, an unknown address returns in microseconds
    // while a wrong password takes ~190 ms — a timing oracle for enumeration.
    const start = performance.now();
    await login({ email: 'nobody@example.com', password: 'whatever' }, CTX);
    expect(performance.now() - start).toBeGreaterThan(20);
  });
});

describe('account lockout', () => {
  it('locks the account after five failures and rejects the correct password', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login({ email: 'owner@loupe.jewelry', password: 'wrong' }, CTX);
    }

    const [locked] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId));
    expect(locked?.failedLoginAttempts).toBeGreaterThanOrEqual(5);
    expect(locked?.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());

    // The right password must not open a locked account — otherwise lockout is
    // only an inconvenience to the legitimate owner.
    const result = await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
  });

  it('lets the account back in once the lock expires', async () => {
    await db
      .update(adminUsers)
      .set({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(adminUsers.id, userId));

    const result = await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    expect(result.ok).toBe(true);
  });
});

describe('session hygiene', () => {
  it('stores no session row containing the raw token', async () => {
    const result = await login({ email: 'owner@loupe.jewelry', password: PASSWORD }, CTX);
    if (!result.ok) throw new Error('expected success');

    const rows = await db.select().from(sessions);
    const raw = result.value.session.token;
    expect(rows.some((r) => JSON.stringify(r).includes(raw))).toBe(false);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(sessions)).toBeDefined();
  });
});
