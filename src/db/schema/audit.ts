import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { actorTypeEnum } from './enums';
import { timestamps } from './_shared';

/**
 * Immutable audit trail.
 *
 * Every mutating request writes one row here, in the same transaction as the
 * change itself — so a change that succeeded is a change that is logged, and a
 * logging failure rolls the change back rather than leaving a gap. There is no
 * UPDATE or DELETE path to this table in application code.
 *
 * This is the difference between "somebody dropped the price of the bridal set
 * by 40% last Thursday" being a mystery and being a two-second query.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    actorType: actorTypeEnum('actor_type').notNull(),
    /**
     * Not a foreign key, deliberately. An audit record must survive the deletion
     * of the account that caused it — a departing employee's row is exactly the
     * row you most want to keep. The label is denormalised for the same reason.
     */
    actorId: text('actor_id'),
    actorLabel: text('actor_label'),

    /** Verb, past tense, dotted: `product.updated`, `session.revoked`. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),

    /**
     * Field-level before/after, already filtered through the same redaction
     * allowlist the logger uses — a password hash must never reach this table
     * just because it happened to be on the row that changed.
     */
    changes: jsonb('changes').$type<{
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    }>(),

    /** HMAC of the client IP, not the IP. Enough to correlate, not to identify. */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    /** Ties the row to the request's `X-Request-Id` and to the structured logs. */
    requestId: text('request_id'),

    ...timestamps,
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, sql`created_at DESC`),
    index('audit_logs_actor_idx').on(t.actorId, sql`created_at DESC`),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_created_idx').on(sql`created_at DESC`),
  ],
);
