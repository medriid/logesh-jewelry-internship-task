import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { adminRoleEnum, adminStatusEnum } from './enums';
import { timestamps } from './_shared';

/**
 * Admin operators. There is no customer account table — the storefront is
 * read-only and anonymous, so the only identities in this system are the people
 * who can change the catalog. Fewer identities, smaller attack surface.
 */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    email: text('email').notNull(),
    name: text('name').notNull(),

    /**
     * Argon2id PHC string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`.
     * The cost parameters live inside the string, so raising them later does not
     * invalidate existing hashes — verification reads the parameters it was
     * created with, and the login path transparently re-hashes on next success.
     */
    passwordHash: text('password_hash').notNull(),

    role: adminRoleEnum('role').notNull().default('READONLY'),
    status: adminStatusEnum('status').notNull().default('INVITED'),

    /**
     * Online-guessing defence, per account rather than per IP — a botnet rotating
     * IPs against one admin account is the realistic attack. Cleared on success.
     */
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    /** Sessions issued before this instant are rejected — used by "log out everywhere". */
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    ...timestamps,
  },
  (t) => [
    // Case-insensitive uniqueness. Owner@loupe.jewelry and owner@loupe.jewelry
    // must not be two accounts.
    uniqueIndex('admin_users_email_lower_uq').on(sql`lower(${t.email})`),
    index('admin_users_role_idx').on(t.role),
  ],
);

/**
 * Server-side sessions.
 *
 * The token the browser holds is 32 random bytes, base64url-encoded, and is
 * never stored. This table holds its SHA-256 digest as the primary key. A dump
 * of this table therefore grants an attacker nothing: they would need to invert
 * SHA-256 to produce a usable cookie. See docs/adr/0003-sessions-over-jwt.md
 * for why this beats a JWT here.
 */
export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token, hex. Not a random id of its own. */
    id: text('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),

    /** Sliding window: pushed forward on use, capped by absoluteExpiresAt. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Hard ceiling set at login. A stolen cookie cannot be renewed indefinitely. */
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),

    /**
     * Client fingerprints, retained for the "your active sessions" screen and for
     * incident response. The IP is stored as an HMAC — enough to spot "this
     * session jumped countries", not enough to be a personal-data liability.
     */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Explicit revocation. Kept rather than deleted so the audit trail stays whole. */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/**
 * Machine credentials, for a POS terminal or a storefront build job that needs
 * write access without a human at a keyboard.
 *
 * Format: `lpe_<prefix>_<secret>`. Only `prefix` is stored in the clear — it
 * makes a leaked key identifiable in a log or a GitHub secret scan without the
 * key itself ever being recoverable from this table.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),

    /** Public, non-secret 8-char identifier. Indexed; the lookup key. */
    prefix: text('prefix').notNull(),
    /** SHA-256 of the full key. Compared in constant time. */
    keyHash: text('key_hash').notNull(),

    /** Least privilege by default: a key grants only what is listed here. */
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    /** Keys expire. An immortal credential is a credential nobody rotates. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('api_keys_prefix_uq').on(t.prefix),
    index('api_keys_active_idx').on(t.revokedAt),
  ],
);

/**
 * Replay protection for unsafe requests.
 *
 * A client may send `Idempotency-Key` on any POST. The first request stores its
 * response here; a retry with the same key returns the stored response instead
 * of creating a second product. `requestHash` guards against a client reusing a
 * key for a *different* body, which is a bug worth surfacing as a 422 rather
 * than silently honouring.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    actorId: text('actor_id').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    /** Set while the first request is still running, so concurrent retries 409. */
    inFlight: boolean('in_flight').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestamps,
  },
  (t) => [index('idempotency_expires_idx').on(t.expiresAt)],
);

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  sessions: many(sessions),
  apiKeys: many(apiKeys),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(adminUsers, { fields: [sessions.userId], references: [adminUsers.id] }),
}));
