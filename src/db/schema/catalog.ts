import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  metalEnum,
  makingChargeTypeEnum,
  occasionEnum,
  pricingModeEnum,
  productStatusEnum,
} from './enums';
import { paise, softDelete, timestamps, tsvector } from './_shared';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A note on units, because it is the single most consequential decision here.
 *
 * Nothing in this schema is a float, and nothing is `numeric`. Every physical or
 * monetary quantity is an integer in its smallest meaningful unit:
 *
 *   money   → paise            (₹1 = 100)
 *   metal   → milligrams       (1 g = 1000)          gold is sold to 3 decimals
 *   stones  → points           (1 carat = 100)       the trade already quotes points
 *   rates   → basis points     (1% = 100)
 *
 * The pricing engine is therefore pure integer arithmetic with one rounding step
 * at the very end. A 22K chain priced at ₹1,04,857.35 is 10485735 — exactly, on
 * every machine, in every JSON payload, forever.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Self-referencing taxonomy: Necklaces → Chokers, Necklaces → Long Chains. */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    // `AnyPgColumn` breaks the type cycle a self-referencing FK would otherwise
    // create. onDelete: 'restrict' — deleting a parent category that still has
    // children should be a loud error, not a silent orphaning of the subtree.
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
      onDelete: 'restrict',
    }),

    imageUrl: text('image_url'),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('categories_slug_uq').on(t.slug),
    index('categories_parent_idx').on(t.parentId),
  ],
);

/**
 * Time-boxed merchandising groups — "Diwali 2026", "Bridal Trousseau".
 *
 * Separate from categories on purpose: a category is what a thing *is* and is
 * permanent; a collection is why we are showing it *this week* and expires. The
 * marketing calendar edits collections without ever touching the taxonomy.
 */
export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    occasion: occasionEnum('occasion').notNull().default('EVERYDAY'),

    heroImageUrl: text('hero_image_url'),
    /** Null start/end = always on. Set both for a festive drop. */
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    isActive: boolean('is_active').notNull().default(true),

    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('collections_slug_uq').on(t.slug),
    index('collections_window_idx').on(t.startsAt, t.endsAt),
    check(
      'collections_window_ordered',
      sql`${t.endsAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Human-facing stock code, printed on the tag. Immutable once issued. */
    sku: text('sku').notNull(),
    /** URL identity. Stable; renaming a product does not break its links. */
    slug: text('slug').notNull(),

    name: text('name').notNull(),
    shortDescription: text('short_description'),
    description: text('description'),

    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),

    // ── Material & certification ─────────────────────────────────────────────
    metal: metalEnum('metal').notNull().default('SILVER'),
    /**
     * Purity as **millesimal fineness** — parts per thousand of pure metal.
     * This is the universal measure, and the only one that spans the catalog:
     *
     *   999 = 24K gold      925 = sterling silver      950 = platinum
     *   916 = 22K gold      750 = 18K gold             585 = 14K gold
     *
     * Karat was the obvious first choice and it was wrong. Silver is not
     * measured in karats, so a `purityKarat` column cannot describe a 925
     * sterling pendant at all — and its CHECK constraint actively rejected one.
     * Fineness describes every metal we sell. Karat is derived for display
     * where it is the customary unit (`fineness × 24 / 1000`).
     */
    finenessPpt: smallint('fineness_ppt').notNull().default(925),
    /**
     * BIS hallmarked. Mandatory for gold jewellery sold in India; voluntary for
     * silver, hence the default of false — most sterling stock is not hallmarked
     * and claiming otherwise on a product page would be a false representation.
     */
    isHallmarked: boolean('is_hallmarked').notNull().default(false),
    /** The six-character alphanumeric HUID stamped on a hallmarked piece. */
    hallmarkNumber: text('hallmark_number'),

    // ── Weights (integers; see the unit note above) ──────────────────────────
    /** Total weight of the finished article, including stones. */
    grossWeightMg: integer('gross_weight_mg').notNull().default(0),
    /** Metal only. This is what a metal rate multiplies. */
    netMetalWeightMg: integer('net_metal_weight_mg').notNull().default(0),
    /** Stone weight in points (1 carat = 100 points). */
    stoneWeightPoints: integer('stone_weight_points').notNull().default(0),

    // ── Pricing ──────────────────────────────────────────────────────────────
    /**
     * Price is a strategy, not a column. See src/lib/pricing/engine.ts.
     *
     * FIXED       — a set selling price, optionally against a struck-through
     *               MRP. This is how fashion, silver and giftware are sold, and
     *               it is the default because it is most of the catalog.
     * METAL_RATE  — computed live from the day's bullion rate. Correct for
     *               solid gold, where the shelf price genuinely moves daily.
     */
    pricingMode: pricingModeEnum('pricing_mode').notNull().default('FIXED'),

    /** FIXED: what the customer pays, before tax handling. */
    sellingPricePaise: paise('selling_price_paise'),
    /**
     * FIXED: the struck-through compare-at price. Nullable — a product at full
     * price has no MRP to show, and storing one equal to the selling price
     * would render as "0% off", which looks broken.
     *
     * The displayed discount percentage is *derived* from the pair rather than
     * stored, because storing all three lets them disagree.
     */
    mrpPaise: paise('mrp_paise'),

    /**
     * METAL_RATE: interpretation depends on `makingChargeType`:
     *   PER_GRAM   → paise per gram of net metal
     *   PERCENTAGE → basis points of metal value
     *   FLAT       → paise for the whole article
     * One column, three conventions, documented once. Three nullable columns
     * would let two of them be set at the same time.
     */
    makingChargeType: makingChargeTypeEnum('making_charge_type').notNull().default('PERCENTAGE'),
    makingChargeValue: paise('making_charge_value').notNull().default(0),
    /** METAL_RATE: metal lost in fabrication, billed on. Basis points. */
    wastageBasisPoints: integer('wastage_basis_points').notNull().default(0),
    /** METAL_RATE: flat value of set stones, independent of the metal rate. */
    stoneValuePaise: paise('stone_value_paise').notNull().default(0),
    /**
     * METAL_RATE: promotional discount on the **making charge only** — which is
     * what the trade actually discounts. "Flat 20% off making charges" is the
     * standard Indian jewellery promotion; nobody discounts the metal, because
     * it is a commodity passed through at cost.
     *
     * FIXED products express their discount through the MRP/selling-price pair
     * instead, and ignore this.
     */
    discountBasisPoints: integer('discount_basis_points').notNull().default(0),

    /**
     * Per-product GST rate in basis points; null falls back to the brand
     * default. Not redundant: this catalog spans 3% jewellery and 12–18%
     * giftware (candles, home decor), so one global rate cannot be right.
     */
    taxRateBasisPoints: integer('tax_rate_basis_points'),
    /**
     * Whether the stored price already contains tax. Indian D2C storefronts
     * almost always quote inclusive — "₹3,650 incl. of all taxes" — so the
     * engine back-calculates the taxable base rather than adding tax on top.
     */
    taxInclusive: boolean('tax_inclusive').notNull().default(true),

    // ── Inventory ────────────────────────────────────────────────────────────
    /**
     * Authoritative on-hand count. Only ever mutated inside a transaction that
     * also appends to `stock_ledger` — see src/server/services/inventory.ts.
     */
    stockQuantity: integer('stock_quantity').notNull().default(0),
    /** Held for pending orders. Sellable = stockQuantity - reservedQuantity. */
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(2),
    /** Made-to-order pieces stay purchasable at zero stock. */
    allowBackorder: boolean('allow_backorder').notNull().default(false),

    // ── Publication ──────────────────────────────────────────────────────────
    status: productStatusEnum('status').notNull().default('DRAFT'),
    isFeatured: boolean('is_featured').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),

    /** Free-form, non-filterable extras (care instructions, packaging notes). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    /**
     * Optimistic concurrency. PATCH requires a matching `If-Match: "<version>"`;
     * two managers editing the same product in two tabs produce a 412, not a
     * silent last-write-wins. Bumped by the update path, not by a trigger, so
     * the increment is visible in the code that causes it.
     */
    version: integer('version').notNull().default(1),

    /**
     * Weighted full-text index, maintained by Postgres itself. Name and SKU rank
     * above the short description, which ranks above the long one — so searching
     * "kundan" surfaces the Kundan choker before a necklace that merely mentions
     * kundan in paragraph four. GENERATED means it can never drift from the row.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(sku, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(short_description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')`,
    ),

    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('products_sku_uq').on(t.sku),
    uniqueIndex('products_slug_uq').on(t.slug),

    // The storefront's default query is "ACTIVE, not deleted, newest first".
    // A partial index keeps DRAFT and ARCHIVED rows out of it entirely.
    index('products_live_idx')
      .on(t.status, t.createdAt)
      .where(sql`deleted_at IS NULL`),
    index('products_category_idx')
      .on(t.categoryId)
      .where(sql`deleted_at IS NULL`),
    index('products_collection_idx').on(t.collectionId),
    index('products_featured_idx')
      .on(t.isFeatured)
      .where(sql`is_featured = true`),
    // GIN over the generated tsvector: this is what makes search O(matches).
    index('products_search_idx').using('gin', t.searchVector),

    // ── Invariants the database enforces, not just the service layer ─────────
    // Application bugs, bad migrations, and somebody at a psql prompt all get
    // stopped here. This is the last line, and it is the one that always holds.
    check('products_stock_non_negative', sql`${t.stockQuantity} >= 0`),
    check('products_reserved_non_negative', sql`${t.reservedQuantity} >= 0`),
    check('products_reserved_within_stock', sql`${t.reservedQuantity} <= ${t.stockQuantity}`),
    check(
      'products_weights_non_negative',
      sql`${t.grossWeightMg} >= 0 AND ${t.netMetalWeightMg} >= 0 AND ${t.stoneWeightPoints} >= 0`,
    ),
    // You cannot have more metal than article.
    check('products_net_within_gross', sql`${t.netMetalWeightMg} <= ${t.grossWeightMg}`),
    // Fineness is parts per thousand: 1–1000. Anything outside is a typo, and
    // 0 would mean base metal sold as precious.
    check('products_fineness_range', sql`${t.finenessPpt} > 0 AND ${t.finenessPpt} <= 1000`),
    check(
      'products_discount_range',
      sql`${t.discountBasisPoints} >= 0 AND ${t.discountBasisPoints} <= 10000`,
    ),
    check(
      'products_tax_rate_range',
      sql`${t.taxRateBasisPoints} IS NULL OR (${t.taxRateBasisPoints} >= 0 AND ${t.taxRateBasisPoints} <= 10000)`,
    ),
    // A FIXED product without a price is unsellable; a METAL_RATE product with
    // no metal prices at zero. Reject both at write time.
    check(
      'products_pricing_coherent',
      sql`(${t.pricingMode} = 'FIXED' AND ${t.sellingPricePaise} IS NOT NULL AND ${t.sellingPricePaise} > 0)
       OR (${t.pricingMode} = 'METAL_RATE' AND ${t.netMetalWeightMg} > 0)`,
    ),
    // A struck-through price below the selling price is not a discount, it is a
    // markup dressed as one. Equal is also rejected: it renders as "0% off".
    check(
      'products_mrp_above_selling',
      sql`${t.mrpPaise} IS NULL OR ${t.sellingPricePaise} IS NULL OR ${t.mrpPaise} > ${t.sellingPricePaise}`,
    ),
  ],
);

/**
 * Variants — the same design in a different size or karat.
 *
 * A 16" and an 18" chain are one product with two variants: they share
 * photography, description, and SEO, but hold stock and weight separately.
 * Weight overrides are nullable and fall back to the parent, so a variant that
 * differs only in ring size does not have to restate everything.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    sku: text('sku').notNull(),
    /** Display label: "22K · 18 inch". */
    name: text('name').notNull(),
    /** The axes that define it: `{ "length": "18in", "karat": 22 }`. */
    options: jsonb('options').$type<Record<string, string | number>>().notNull().default({}),

    /** Null → inherit from the parent product. */
    netMetalWeightMg: integer('net_metal_weight_mg'),
    grossWeightMg: integer('gross_weight_mg'),
    /** Signed adjustment on top of the computed parent price. May be negative. */
    priceDeltaPaise: paise('price_delta_paise').notNull().default(0),

    stockQuantity: integer('stock_quantity').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),

    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),

    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('product_variants_sku_uq').on(t.sku),
    index('product_variants_product_idx').on(t.productId),
    // Exactly one default per product, enforced by a partial unique index.
    uniqueIndex('product_variants_one_default_uq')
      .on(t.productId)
      .where(sql`is_default = true AND deleted_at IS NULL`),
    check('product_variants_stock_non_negative', sql`${t.stockQuantity} >= 0`),
    check(
      'product_variants_reserved_within_stock',
      sql`${t.reservedQuantity} <= ${t.stockQuantity}`,
    ),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    url: text('url').notNull(),
    /** Required, not optional. An unlabelled product photo is an accessibility bug. */
    altText: text('alt_text').notNull(),

    width: integer('width'),
    height: integer('height'),
    /** Tiny base64 LQIP so detail pages do not flash white. */
    placeholder: text('placeholder'),
    /** SHA-256 of the bytes — lets us reject a re-upload of the same file. */
    contentHash: text('content_hash'),

    position: integer('position').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),

    ...timestamps,
  },
  (t) => [
    index('product_images_product_idx').on(t.productId, t.position),
    uniqueIndex('product_images_one_primary_uq')
      .on(t.productId)
      .where(sql`is_primary = true`),
  ],
);

// ── Relations (used by Drizzle's relational query builder) ───────────────────

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_tree',
  }),
  children: many(categories, { relationName: 'category_tree' }),
  products: many(products),
}));

export const collectionsRelations = relations(collections, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  collection: one(collections, { fields: [products.collectionId], references: [collections.id] }),
  variants: many(productVariants),
  images: many(productImages),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));
