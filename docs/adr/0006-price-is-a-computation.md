# 0006 — Price is a computation, not a column

**Status:** Accepted, amended by [0008](0008-fineness-and-pricing-strategy.md) · **Date:** 2026-09-05

> **Amended.** This ADR assumed every product is priced from the metal rate.
> [ADR 0008](0008-fineness-and-pricing-strategy.md) makes `FIXED` the default
> after examining the real catalog. Everything below still describes the
> `METAL_RATE` mode, which is retained in full.

## Context

Almost every product-catalog schema has `products.price`. For gold jewellery
that column is wrong by lunchtime.

Indian gold retail does not work on fixed prices. The shelf price of a 22K chain
is derived each morning from the bullion rate:

```
metal value   = (gold rate per gram × net metal weight) × (1 + wastage)
making charge = per-gram | percentage of metal value | flat
subtotal      = metal value + making charge + stone value
after discount= subtotal − discount
total         = after discount + GST
```

Two products with identical photographs and identical descriptions have
different prices if one is 8.2 g and the other 8.6 g. The same product has a
different price today than it did yesterday.

## Decision

`products` stores the **inputs** — net metal weight, purity, making-charge type
and value, wastage, stone value, tax rate, discount. `metal_rates` stores the
day's rate, append-only and time-stamped. Price is produced by a pure function
in `src/lib/pricing/engine.ts`, which takes a product and a rate and returns a
fully itemised breakdown.

Products that genuinely have a fixed price (silver, fashion pieces, imported
stock) set `pricingMode = 'FIXED'` and use `fixedPricePaise`. The database
`CHECK` refuses a FIXED product with no price and a METAL_RATE product with no
metal, so neither mode can be half-configured.

## Rationale

**It is how the business actually works.** A schema that cannot express "this
necklace costs more today than yesterday, because gold moved" is not modelling
jewellery retail; it is modelling a t-shirt shop.

**Reproducibility.** Rates are append-only with `effectiveFrom`, so the price
quoted at any past instant can be recomputed exactly. When a customer rings up
about a receipt from last Tuesday, that is a query, not an argument.

**Transparency is the product.** Because the engine returns a breakdown rather
than a number, the API can show a buyer that they are paying ₹X for 18.4 g of
metal, ₹Y in making charges, and ₹Z in GST. That is the difference between a
sticker price and a receipt, and it is the whole reason the brand is called
Loupe.

## Alternatives considered

**Store a price, recompute nightly with a cron job.** Simpler reads. But the
stored price is stale between runs, a failed job silently sells at yesterday's
rate, and historical quotes are unrecoverable.

**Compute in the database as a generated column.** Cannot work: the rate lives in
another table and changes independently, and generated columns must be immutable
functions of the row.

## Consequences

**Accepted cost.** Reads do work. Listing 24 products means one rate lookup —
the current rate per (metal, karat), fetched once and applied to all of them, not
per row — plus arithmetic. The current rate is cached in-process with a short
TTL; it changes once or twice a day.

Sorting by price is the real cost: it cannot be a plain `ORDER BY` on an indexed
column. The current implementation computes prices for the filtered page and
sorts in the service layer, which is correct but bounded by page size. If the
catalog outgrows that, the fix is a materialised `price_cache` table refreshed on
rate change — deliberately deferred rather than built for a catalog this size.

**Gained.** Prices are never stale, never wrong, always explainable, and always
reproducible.
