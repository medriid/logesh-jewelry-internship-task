import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { stockReasonEnum } from './enums';
import { timestamps } from './_shared';
import { products, productVariants } from './catalog';
import { adminUsers } from './auth';

/**
 * Append-only stock ledger.
 *
 * `products.stock_quantity` is a cached balance; this table is the truth. Every
 * movement is a row, written in the same transaction that mutates the balance,
 * and no code path anywhere is permitted to change a quantity without appending
 * here — see src/server/services/inventory.ts, which is the only writer.
 *
 * The reason this is a ledger and not an UPDATE:
 *   • "why is this necklace showing 3 when the tray has 2" becomes answerable,
 *   • the balance can be rebuilt from scratch if it ever drifts,
 *   • a decrement that races another decrement is caught by the CHECK on
 *     products.stock_quantity rather than quietly overselling a one-of-a-kind
 *     piece, which for jewellery is not an inconvenience — it is a piece that
 *     does not exist and a customer who was promised it.
 *
 * `balanceAfter` is denormalised on purpose: it makes each row independently
 * auditable without replaying the whole history, and disagreement between it and
 * the running sum is itself the alarm.
 */
export const stockLedger = pgTable(
  'stock_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Null when the product has no variants and stock is held at product level. */
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),

    /** Signed. +5 goods received, -1 sold. Never zero. */
    delta: integer('delta').notNull(),
    /** On-hand count immediately after this movement was applied. */
    balanceAfter: integer('balance_after').notNull(),

    reason: stockReasonEnum('reason').notNull(),
    /** Free-text link back to the cause: an order number, an invoice, a count sheet. */
    reference: text('reference'),
    note: text('note'),

    actorId: uuid('actor_id').references(() => adminUsers.id, { onDelete: 'set null' }),

    ...timestamps,
  },
  (t) => [
    index('stock_ledger_product_idx').on(t.productId, sql`created_at DESC`),
    index('stock_ledger_variant_idx').on(t.variantId),
    index('stock_ledger_reason_idx').on(t.reason),
    check('stock_ledger_delta_nonzero', sql`${t.delta} <> 0`),
    check('stock_ledger_balance_non_negative', sql`${t.balanceAfter} >= 0`),
  ],
);
