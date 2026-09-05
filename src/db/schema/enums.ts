import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Domain vocabularies.
 *
 * These are Postgres enums rather than free text or lookup tables: the set of
 * legal values is small, closed, and changes at the speed of a code deploy. The
 * database refuses a bad value even if a bug gets past Zod.
 */

/** Who a catalog change is attributable to, for the audit trail. */
export const actorTypeEnum = pgEnum('actor_type', ['ADMIN', 'API_KEY', 'SYSTEM']);

/**
 * Admin roles, ordered least → most privileged. Permissions are not stored
 * per-user; they are derived from the role by an explicit matrix in
 * src/lib/auth/permissions.ts so that "what can a MANAGER do" has exactly one answer.
 */
export const adminRoleEnum = pgEnum('admin_role', ['READONLY', 'STAFF', 'MANAGER', 'OWNER']);

export const adminStatusEnum = pgEnum('admin_status', ['ACTIVE', 'SUSPENDED', 'INVITED']);

/** Publication state. Only ACTIVE products are visible to unauthenticated callers. */
export const productStatusEnum = pgEnum('product_status', ['DRAFT', 'ACTIVE', 'ARCHIVED']);

export const metalEnum = pgEnum('metal', ['GOLD', 'ROSE_GOLD', 'WHITE_GOLD', 'SILVER', 'PLATINUM']);

/**
 * How a product's price is arrived at.
 *
 * FIXED       — a flat listed price. Fashion pieces, silver, imported stock.
 * METAL_RATE  — computed live from the day's metal rate. This is how real Indian
 *               gold retail works: the sticker price of a 22K chain changes daily
 *               with the bullion market, so storing one is wrong by lunchtime.
 *               See src/lib/pricing/engine.ts.
 */
export const pricingModeEnum = pgEnum('pricing_mode', ['FIXED', 'METAL_RATE']);

/**
 * Making charge (labour) conventions, all three of which are in live use by
 * Indian jewellers depending on the piece.
 */
export const makingChargeTypeEnum = pgEnum('making_charge_type', [
  'PER_GRAM', // ₹X per gram of metal — machine-made chains
  'PERCENTAGE', // X% of metal value — the most common retail convention
  'FLAT', // ₹X for the article — handcrafted / antique work
]);

/**
 * Why stock moved. Every row in the stock ledger carries one; there is no way to
 * change a quantity without stating a reason.
 */
export const stockReasonEnum = pgEnum('stock_reason', [
  'INITIAL', // opening balance at product creation
  'RESTOCK', // goods received
  'SALE', // sold
  'RESERVATION', // held for a pending order
  'RELEASE', // reservation expired or cancelled
  'RETURN', // customer return back into sellable stock
  'DAMAGE', // written off
  'CORRECTION', // manual reconciliation after a physical count
]);

/** Merchandising buckets that drive the festive/occasion campaigns. */
export const occasionEnum = pgEnum('occasion', [
  'EVERYDAY',
  'BRIDAL',
  'FESTIVE',
  'GIFTING',
  'INVESTMENT',
]);

/** Types an admin-defined custom attribute can take. Drives validation and filter UI. */
export const attributeTypeEnum = pgEnum('attribute_type', ['TEXT', 'NUMBER', 'BOOLEAN', 'ENUM']);
