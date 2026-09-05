import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { adminUsers } from '@/db/schema';
import { equalizeTimingForUnknownUser, hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession, type IssuedSession } from '@/lib/auth/session';
import { selfAttribution, writeAudit } from '@/lib/observability/audit';
import type { RequestContext } from '@/lib/http/context';
import type { Role } from '@/lib/auth/permissions';
import type { LoginInput } from '@/lib/validation/auth';

/**
 * Login.
 *
 * Every failure path returns the same `INVALID_CREDENTIALS` and costs the same
 * time. A wrong password, an unknown address, a suspended account and a locked
 * one are indistinguishable from outside — distinguishing them tells an
 * attacker which guesses were close, and "this email exists" is the first step
 * of a targeted attack.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 60_000;
const LOCKOUT_MAX_MS = 60 * 60 * 1000;

export type LoginFailure = 'INVALID_CREDENTIALS';

export type LoginSuccess = {
  session: IssuedSession;
  user: { id: string; email: string; name: string; role: Role };
};

export type LoginResult = { ok: true; value: LoginSuccess } | { ok: false; reason: LoginFailure };

export async function login(
  input: LoginInput,
  ctx: Pick<RequestContext, 'requestId' | 'ip' | 'userAgent'>,
): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = ${input.email}`)
    .limit(1);

  if (!user) {
    // Burn the same CPU a real verification would, or the response time itself
    // becomes a user-enumeration oracle.
    await equalizeTimingForUnknownUser(input.password);
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await equalizeTimingForUnknownUser(input.password);
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  const { valid, needsRehash } = await verifyPassword(input.password, user.passwordHash);

  if (!valid) {
    await recordFailure(user.id, user.failedLoginAttempts + 1);
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  // Verified, but still not allowed in — and the caller learns nothing extra.
  if (user.status !== 'ACTIVE') return { ok: false, reason: 'INVALID_CREDENTIALS' };

  const session = await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
        // Transparent upgrade when the cost factor has been raised since this
        // hash was made. The user notices nothing.
        ...(needsRehash && { passwordHash: await hashPassword(input.password) }),
      })
      .where(eq(adminUsers.id, user.id));

    await writeAudit(
      tx,
      { action: 'session.created', entityType: 'admin_user', entityId: user.id },
      selfAttribution(user),
      ctx,
    );

    // `tx`, not `db` — see the note on createSession.
    return createSession(user.id, { ip: ctx.ip, userAgent: ctx.userAgent }, tx);
  });

  return {
    ok: true,
    value: {
      session,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
  };
}

/**
 * Lockout is per *account*, with exponential backoff.
 *
 * Per-IP throttling is also in place, but on its own it is the wrong control
 * here: the realistic attack on a known admin address is a botnet rotating
 * addresses, where every request looks like a first attempt from a new client.
 */
async function recordFailure(userId: string, attempts: number): Promise<void> {
  const shouldLock = attempts >= MAX_ATTEMPTS;
  const backoff = Math.min(LOCKOUT_BASE_MS * 2 ** (attempts - MAX_ATTEMPTS), LOCKOUT_MAX_MS);

  await db
    .update(adminUsers)
    .set({
      failedLoginAttempts: attempts,
      ...(shouldLock && { lockedUntil: new Date(Date.now() + backoff) }),
    })
    .where(eq(adminUsers.id, userId));
}
