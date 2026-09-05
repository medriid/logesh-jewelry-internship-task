import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { metalEnum } from './enums';
import { paise, timestamps } from './_shared';
import { adminUsers } from './auth';

/**
 * The day's metal rate.
 *
 * This table is the reason the catalog can tell the truth about price. In Indian
 * gold retail the shelf price of a 22K chain is not a stored number — it is
 * recomputed every morning from the bullion rate. A schema that keeps a single
 * `price` column on the product is wrong by lunchtime and, worse, silently wrong.
 *
 * Rates are append-only and stamped with `effectiveFrom`, so:
 *   • today's price is a lookup of the latest row, and
 *   • last Tuesday's quoted price is reproducible for a customer dispute,
 * which is the part that actually matters when someone rings up about a receipt.
 */
export const metalRates = pgTable(
  'metal_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    metal: metalEnum('metal').notNull(),
    /**
     * Millesimal fineness, matching products.fineness_ppt. 916 (22K) trades at
     * roughly 91.6% of the 999 rate, which is exactly what fineness means.
     */
    finenessPpt: smallint('fineness_ppt').notNull(),

    /** Integer paise per gram. ₹7,412.50/g is 741250. */
    ratePerGramPaise: paise('rate_per_gram_paise').notNull(),

    /** Where the number came from: 'MANUAL', 'IBJA', a vendor feed name. */
    source: text('source').notNull().default('MANUAL'),

    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),

    ...timestamps,
  },
  (t) => [
    // One rate per metal+purity per instant. Publishing the same rate twice by
    // accident is a real operational mistake; make the database refuse it.
    uniqueIndex('metal_rates_effective_uq').on(t.metal, t.finenessPpt, t.effectiveFrom),
    // The hot query is "latest rate for GOLD/22", so index descending by time.
    index('metal_rates_lookup_idx').on(t.metal, t.finenessPpt, sql`${t.effectiveFrom} DESC`),
    check('metal_rates_positive', sql`${t.ratePerGramPaise} > 0`),
    check('metal_rates_fineness_range', sql`${t.finenessPpt} > 0 AND ${t.finenessPpt} <= 1000`),
  ],
);
