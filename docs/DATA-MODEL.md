# Data model

14 tables. Source: [`src/db/schema/`](../src/db/schema/) · Generated SQL:
[`drizzle/`](../drizzle/)

## Units — read this first

Nothing is a float. Nothing is `numeric`. Every physical and monetary quantity is
an integer in its smallest meaningful unit.

| Quantity           | Unit         | Example                     |
| ------------------ | ------------ | --------------------------- |
| Money              | paise        | `₹1,04,857.35` → `10485735` |
| Metal weight       | milligrams   | `18.4 g` → `18400`          |
| Stone weight       | points       | `0.75 ct` → `75`            |
| Rates, percentages | basis points | `3%` → `300`                |

These are the trade's own units — gold is quoted to three decimal grams,
diamonds in points — not an encoding imposed on the domain. Full reasoning in
[ADR 0005](adr/0005-integer-money-and-weights.md).

## Tables

### Catalog

| Table              | Purpose                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`       | Self-referencing taxonomy. `Necklaces → Chokers`. `onDelete: restrict` — orphaning a subtree should be a loud error.                                                        |
| `collections`      | Time-boxed merchandising. Separate from categories because a category is what a thing _is_ and is permanent; a collection is why we are showing it _this week_ and expires. |
| `products`         | 36 columns: identity, material, weights, pricing inputs, inventory, publication.                                                                                            |
| `product_variants` | Same design, different size or karat. Shares photography and copy; holds stock and weight separately. Weight overrides are nullable and fall back to the parent.            |
| `product_images`   | `altText` is `NOT NULL` — an unlabelled product photo is an accessibility bug, not an optional field.                                                                       |

### Extensibility

| Table                   | Purpose                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attribute_definitions` | Admin-defined fields: "Gemstone", "Chain Length", "Temple Motif". Created through the console; new field and new filter facet with no deploy.                   |
| `product_attributes`    | Values, in three typed columns so a numeric filter is a real numeric comparison against an index, not a runtime cast. A `CHECK` enforces exactly one populated. |

Why not a `jsonb` blob? Because these must be _filterable_ and _validated_ — a
definition carries a type, a unit, an allowed-values list, and an `isFilterable`
flag. Freeform notes nobody filters on do go in `products.metadata`, which is
exactly that blob.

### Pricing

| Table         | Purpose                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metal_rates` | Append-only, time-stamped rate per (metal, fineness). Today's price is a lookup of the latest row; last Tuesday's is reproducible. [ADR 0006](adr/0006-price-is-a-computation.md). |

Products carry **two** pricing shapes, selected by `pricing_mode`
([ADR 0008](adr/0008-fineness-and-pricing-strategy.md)):

| Mode                | Columns used                                                                                                   | For                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `FIXED` _(default)_ | `selling_price_paise`, `mrp_paise`                                                                             | Sterling silver, fashion, giftware. Discount % is derived from the pair, never stored. |
| `METAL_RATE`        | `net_metal_weight_mg`, `making_charge_*`, `wastage_basis_points`, `stone_value_paise`, `discount_basis_points` | Solid gold, where the shelf price genuinely moves daily.                               |

`tax_inclusive` defaults true — Indian D2C quotes "incl. of all taxes", so the
engine back-calculates the base. `tax_rate_basis_points` is per product because
this catalog spans 3% jewellery and 12% candles.

### Inventory

| Table          | Purpose                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock_ledger` | Append-only. `products.stock_quantity` is a cached balance; this is the truth. Every row carries a signed delta, a reason, and the balance after. |

`balanceAfter` is denormalised deliberately: it makes each row auditable without
replaying history, and disagreement with the running sum is itself the alarm.

### Auth

| Table              | Purpose                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_users`      | Argon2id hash, role, lockout state. Case-insensitive unique email via `lower(email)`.                                                                                |
| `sessions`         | Primary key **is** the SHA-256 of the token. The token is never stored.                                                                                              |
| `api_keys`         | Machine credentials. Clear-text prefix for identification, hash for verification, scopes for least privilege, expiry because immortal credentials never get rotated. |
| `idempotency_keys` | Replay protection for `POST`. `requestHash` catches a client reusing a key for a different body — a bug worth a 422, not a silent success.                           |

### Audit

| Table        | Purpose                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_logs` | Immutable. Written in the same transaction as the change. `actorId` is deliberately **not** a foreign key: a departing employee's row is exactly the row you most want to keep. |

## Invariants Postgres enforces

20 `CHECK` constraints. These hold even when the service layer is wrong, a
migration is bad, or somebody is at a psql prompt.

| Constraint                              | Prevents                                                             |
| --------------------------------------- | -------------------------------------------------------------------- |
| `products_stock_non_negative`           | Overselling                                                          |
| `products_reserved_within_stock`        | Reserving inventory that does not exist                              |
| `products_net_within_gross`             | More metal than the article weighs                                   |
| `products_karat_valid`                  | A "20K" hallmark, which is not a grade                               |
| `products_pricing_coherent`             | A FIXED product with no price, or a METAL_RATE product with no metal |
| `products_discount_range`               | A discount above 100%                                                |
| `product_attributes_exactly_one_value`  | An attribute that is text _and_ a number                             |
| `attribute_definitions_enum_has_values` | An ENUM attribute nothing can satisfy                                |
| `stock_ledger_delta_nonzero`            | A ledger row that records no movement                                |
| `collections_window_ordered`            | A campaign ending before it starts                                   |

Plus partial unique indexes for "exactly one default variant per product" and
"exactly one primary image per product".

All verified against real Postgres in
[`tests/integration/schema-invariants.test.ts`](../tests/integration/schema-invariants.test.ts).

## Search

`products.search_vector` is a `GENERATED ALWAYS` `tsvector`, weighted:

| Weight | Field              |
| ------ | ------------------ |
| A      | `name`, `sku`      |
| B      | `shortDescription` |
| C      | `description`      |

Maintained by Postgres inside the write transaction, so it cannot go stale and
cannot need a reindex. A `GIN` index covers it. Searching "kundan" returns the
Kundan choker above a necklace that merely mentions kundan in paragraph four.
[ADR 0007](adr/0007-postgres-fts.md).

## Indexing notes

- `products_live_idx` is **partial** (`WHERE deleted_at IS NULL`) on
  `(status, created_at)` — the storefront's default query. `DRAFT` and deleted
  rows stay out of the index entirely.
- `metal_rates_lookup_idx` is `(metal, purity_karat, effective_from DESC)`, so
  "today's rate" is an index-only fetch of the first row.
- `audit_logs` is indexed by entity, actor, action and time — the four questions
  anyone actually asks of an audit trail.
