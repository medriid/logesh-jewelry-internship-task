import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { attributeTypeEnum } from './enums';
import { timestamps } from './_shared';
import { products } from './catalog';

/**
 * Admin-defined product attributes — the customisation surface.
 *
 * The fixed columns on `products` cover what every piece of gold jewellery has:
 * weight, purity, hallmark. But a jeweller will always want a field we did not
 * anticipate — "Gemstone", "Chain Length", "Enamel Work", "Temple Motif" — and
 * the honest answer to "can you add a field" should not be "yes, in a sprint,
 * behind a migration".
 *
 * So: attribute *definitions* are rows, created by a MANAGER through the admin
 * console, and values hang off them. New field, new filter facet, no deploy.
 *
 * Why not just a `jsonb` blob on products? Because these need to be *filterable*
 * and *validated*. A definition carries a type, a unit, an allowed-values list,
 * and an `isFilterable` flag that decides whether it appears as a facet in
 * search — none of which a bare blob can express. Freeform notes that nobody
 * filters on still go in `products.metadata`, which is exactly that blob.
 */
export const attributeDefinitions = pgTable(
  'attribute_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Machine key used in query strings: `?attr.gemstone=ruby`. */
    key: text('key').notNull(),
    /** Human label shown in the admin form and on the product page. */
    label: text('label').notNull(),
    description: text('description'),

    type: attributeTypeEnum('type').notNull().default('TEXT'),
    /** Display suffix — "inch", "mm", "ct". Presentation only. */
    unit: text('unit'),
    /** Permitted values when type = ENUM. Validated on write. */
    allowedValues: text('allowed_values').array(),

    /** Show as a facet in search and expose as a filter param. */
    isFilterable: boolean('is_filterable').notNull().default(false),
    /** Include in the tsvector-adjacent keyword match. */
    isSearchable: boolean('is_searchable').notNull().default(false),
    isRequired: boolean('is_required').notNull().default(false),
    position: integer('position').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('attribute_definitions_key_uq').on(t.key),
    // Keys go into URLs and index names; keep them boring.
    check('attribute_definitions_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    // An ENUM attribute with no allowed values can never be satisfied.
    check(
      'attribute_definitions_enum_has_values',
      sql`${t.type} <> 'ENUM' OR (${t.allowedValues} IS NOT NULL AND array_length(${t.allowedValues}, 1) > 0)`,
    ),
  ],
);

/**
 * Attribute values, one row per (product, attribute).
 *
 * Stored in three typed columns rather than one text column, so that a numeric
 * filter is a real numeric comparison — `?attr.chain_length_gte=18` has to use
 * an index, not cast strings at query time. Exactly one of the three is
 * populated, enforced below.
 */
export const productAttributes = pgTable(
  'product_attributes',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributeDefinitions.id, { onDelete: 'cascade' }),

    valueText: text('value_text'),
    /** Scaled integer (×1000) so 18.5 inches is 18500 — no floats here either. */
    valueNumber: integer('value_number'),
    valueBoolean: boolean('value_boolean'),

    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.attributeId] }),
    index('product_attributes_attr_idx').on(t.attributeId),
    // Filter lookups go attribute-first: "everything with gemstone = ruby".
    index('product_attributes_text_lookup_idx').on(t.attributeId, t.valueText),
    index('product_attributes_number_lookup_idx').on(t.attributeId, t.valueNumber),
    check(
      'product_attributes_exactly_one_value',
      sql`(CASE WHEN ${t.valueText} IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN ${t.valueNumber} IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN ${t.valueBoolean} IS NOT NULL THEN 1 ELSE 0 END) = 1`,
    ),
  ],
);
