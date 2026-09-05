import { sql } from 'drizzle-orm';
import { bigint, customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * A Postgres `tsvector`. Drizzle has no first-class type for it, so we declare
 * one; it is only ever populated by a GENERATED ALWAYS expression, never written
 * from application code.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * Money, always as an integer count of the currency's minor unit (paise).
 *
 * Never `numeric`, never `float`. Two reasons: floating point cannot represent
 * ₹1,04,857.35 exactly, and `numeric` arrives in JavaScript as a string that
 * somebody will eventually `parseFloat`. An integer number of paise is exact,
 * cheap to sum, and impossible to misread. ₹90 trillion fits inside
 * Number.MAX_SAFE_INTEGER, so `mode: 'number'` is safe for a jewellery catalog.
 */
export const paise = (name: string) => bigint(name, { mode: 'number' });

/** Every table carries these. `timestamptz`, never a naive local timestamp. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Soft deletion. Catalog rows are referenced by orders, audit logs, and shared
 * links; hard-deleting one turns those into dangling references. Every read path
 * filters `deletedAt IS NULL`, and OWNER can still purge for real via
 * `DELETE /api/v1/products/:id?purge=true`.
 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
};

/** Helper for `now()` defaults inside raw SQL fragments. */
export const now = sql`now()`;
