import 'server-only';

import { and, eq, gt, gte, isNull, lt, or, sql } from 'drizzle-orm';

import { env, isProduction } from '@/config/env';
import { db, type Database } from '@/db';
import { adminUsers, sessions } from '@/db/schema';
import { generateToken, hashIp, hashToken } from './tokens';
import type { Role } from './permissions';

/**
 * Server-side sessions. See docs/adr/0003-sessions-over-jwt.md.
 *
 * The browser holds 32 random bytes. The database holds only their SHA-256
 * digest, as the primary key of `sessions` — so a full dump of that table
 * cannot be turned into a working cookie.
 */

/**
 * The `__Host-` prefix is the strongest cookie guarantee a browser offers: the
 * cookie must be Secure, Path=/, and have no Domain, which means a compromised
 * or hostile subdomain cannot overwrite it. Session fixation via subdomain is a
 * real attack on any site with user content on a sibling host.
 *
 * The prefix requires Secure, and Secure requires HTTPS, so local http:// dev
 * uses the plain name. Production always gets the hardened one.
 */
export const SESSION_COOKIE = isProduction ? '__Host-loupe_session' : 'loupe_session';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type ActiveSession = {
  id: string;
  user: SessionUser;
  expiresAt: Date;
  absoluteExpiresAt: Date;
};

export type CookieAttributes = {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  expires: Date;
};

/**
 * `SameSite=Lax`, not `Strict`.
 *
 * Strict would drop the cookie on any cross-site navigation — following a link
 * from an email straight into `/admin` would land on the login page despite a
 * valid session. Lax keeps top-level GET navigations working while still
 * blocking cross-site POSTs, and the CSRF token covers what remains.
 */
export function cookieAttributes(value: string, expires: Date): CookieAttributes {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires,
  };
}

export type IssuedSession = { token: string; cookie: CookieAttributes; expiresAt: Date };

/**
 * @param executor Pass the surrounding transaction when there is one.
 *
 * Not optional plumbing. Calling this with the module-level `db` from inside an
 * open transaction deadlocks: the transaction holds the connection while the
 * insert queues behind it. PGlite has exactly one connection and production
 * runs `max: 1`, so it hangs in both — which is how this was found.
 */
export async function createSession(
  userId: string,
  context: { ip?: string | null; userAgent?: string | null } = {},
  executor: Database = db,
): Promise<IssuedSession> {
  const token = generateToken();
  const now = Date.now();

  const expiresAt = new Date(
    now + Math.min(env.SESSION_IDLE_TTL_SECONDS, env.SESSION_ABSOLUTE_TTL_SECONDS) * 1000,
  );
  // Fixed at login and never extended. A stolen cookie cannot be kept alive
  // indefinitely just by using it.
  const absoluteExpiresAt = new Date(now + env.SESSION_ABSOLUTE_TTL_SECONDS * 1000);

  await executor.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    absoluteExpiresAt,
    ipHash: hashIp(context.ip),
    userAgent: context.userAgent?.slice(0, 512) ?? null,
  });

  return { token, expiresAt, cookie: cookieAttributes(token, expiresAt) };
}

/**
 * Resolve a raw cookie value to a live session, or null.
 *
 * Every rejection returns the same `null`: an expired session, a revoked one, a
 * suspended account and a token that was never valid are indistinguishable to
 * the caller. Distinguishing them would tell an attacker which guesses were
 * close.
 */
export async function validateSession(token: string | undefined): Promise<ActiveSession | null> {
  if (!token) return null;

  const id = hashToken(token);
  const now = new Date();

  const [row] = await db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      createdAt: sessions.createdAt,
      revokedAt: sessions.revokedAt,
      userId: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      status: adminUsers.status,
      passwordChangedAt: adminUsers.passwordChangedAt,
    })
    .from(sessions)
    .innerJoin(adminUsers, eq(sessions.userId, adminUsers.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt <= now || row.absoluteExpiresAt <= now) return null;
  if (row.status !== 'ACTIVE') return null;

  // "Change my password" must mean "log the attacker out". Any session issued
  // before the last password change is dead, without needing to find and
  // revoke each one.
  if (row.createdAt < row.passwordChangedAt) return null;

  const expiresAt = await slideExpiry(row.id, row.expiresAt, row.absoluteExpiresAt, now);

  return {
    id: row.id,
    expiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    user: { id: row.userId, email: row.email, name: row.name, role: row.role },
  };
}

/**
 * Push the idle deadline forward, capped by the absolute one.
 *
 * Only written when it actually moves by more than a minute — otherwise every
 * request in a busy admin session becomes a write, turning a read-mostly table
 * into a write-hot one for no benefit.
 */
async function slideExpiry(
  sessionId: string,
  current: Date,
  absolute: Date,
  now: Date,
): Promise<Date> {
  const target = new Date(
    Math.min(now.getTime() + env.SESSION_IDLE_TTL_SECONDS * 1000, absolute.getTime()),
  );

  const [updated] = await db
    .update(sessions)
    .set({ expiresAt: target, lastUsedAt: now })
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        lt(sessions.expiresAt, new Date(target.getTime() - 60_000)),
      ),
    )
    .returning({ expiresAt: sessions.expiresAt });
  return updated?.expiresAt ?? current;
}

export async function revokeSession(sessionId: string): Promise<void> {
  // Marked, not deleted, so the audit trail keeps its reference.
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length;
}

/** Cookie that clears the session client-side. */
export function clearedCookie(): CookieAttributes {
  return cookieAttributes('', new Date(0));
}

/**
 * Delete sessions that expired or were revoked more than a week ago. Called by
 * a scheduled job — without it the table grows forever, and an index over dead
 * rows slows down every login.
 */
export async function pruneExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, cutoff),
        lt(sessions.absoluteExpiresAt, cutoff),
        lt(sessions.revokedAt, cutoff),
      ),
    )
    .returning({ id: sessions.id });
  return deleted.length;
}

/** Sessions a user can see and revoke on an "active sessions" screen. */
export async function listSessionsForUser(userId: string) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      lastUsedAt: sessions.lastUsedAt,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(adminUsers, eq(sessions.userId, adminUsers.id))
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.absoluteExpiresAt, new Date()),
        eq(adminUsers.status, 'ACTIVE'),
        gte(sessions.createdAt, adminUsers.passwordChangedAt),
      ),
    )
    .orderBy(sql`${sessions.lastUsedAt} DESC`);
}
