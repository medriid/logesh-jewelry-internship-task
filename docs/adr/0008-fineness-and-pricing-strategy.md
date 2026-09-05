# 0008 — Fineness over karat, and pricing as a strategy

**Status:** Accepted · **Date:** 2026-09-05 · **Amends:**
[0005](0005-integer-money-and-weights.md), [0006](0006-price-is-a-computation.md)

## Context

[ADR 0006](0006-price-is-a-computation.md) was written against an assumed
business: a 22K hallmarked gold retailer. Every product was priced from the
day's bullion rate, and the schema said so — `purityKarat` with a
`CHECK (purity_karat IN (9,14,18,22,24))`, and a `pricing_mode` defaulting to
`METAL_RATE`.

Then I looked at the actual catalog this is being built for. It sells:

- **925 sterling silver**, oxidised, antique, zircon, crystal and kundan pieces
- at **fixed prices with heavy discounting** — ₹3,650 struck through from ₹7,000
- quoted **inclusive of tax**
- alongside **candles, home decor, keychains and rakhi hampers**

Two assumptions broke at once.

## What was wrong

**Karat cannot express sterling silver.** Silver purity is 925 parts per
thousand; it is not measured in karats at all. The `purityKarat` column could
not describe most of the catalog, and its `CHECK` constraint actively _rejected_
a 925 pendant. The schema was not merely unhelpful — it was a hard blocker.

**Metal-rate pricing is wrong for fashion jewellery.** A silver filigree pendant
does not reprice daily against bullion. It has a price, and a sale price, and
the difference is a marketing decision, not a market one. Building the gold
engine as the _only_ mode would have been an elegant solution to a problem this
business does not have.

## Decision

**Purity is millesimal fineness** — parts per thousand — on both `products` and
`metal_rates`:

| Fineness | Metal           |
| -------- | --------------- |
| 999      | 24K gold        |
| 950      | Platinum        |
| 925      | Sterling silver |
| 916      | 22K gold        |
| 750      | 18K gold        |

One column that describes every metal sold. Karat is derived for display where
it is the customary unit (`fineness × 24 / 1000`).

**Pricing is a strategy, and `FIXED` is the default:**

- `FIXED` — `sellingPricePaise` plus an optional `mrpPaise` compare-at. The
  discount percentage is _derived_ from the pair, never stored, because storing
  all three lets them disagree.
- `METAL_RATE` — the engine from ADR 0006, retained in full.

**Tax is inclusive by default.** Indian D2C storefronts quote "₹3,650 incl. of
all taxes", so the engine back-calculates the taxable base rather than adding
tax on top. `taxRateBasisPoints` is per product, and now earns its place: a
catalog spanning 3% jewellery and 12% candles cannot have one global rate.

## What survived

Everything in [ADR 0005](0005-integer-money-and-weights.md) — integers only, in
each quantity's smallest unit — was unaffected, and the discount arithmetic
vindicated it. `₹3,650` from `₹7,000` is 47.857%, displayed as **47%** because
the engine floors rather than rounds: overstating a discount is a consumer-
protection problem, not a rounding preference. That is exact integer arithmetic
producing a number that matches the live storefront, and it is
[a test](../../tests/unit/pricing-engine.test.ts).

The engine's shape survived too. Because it was already a pure function over
(product, rate), adding a second mode was a branch, not a rewrite.

## Consequences

**Accepted cost.** A second migration (`0001_fineness_and_fixed_pricing`)
dropping and recreating columns rather than renaming — `purity_karat = 22` and
`fineness_ppt = 916` are different values, so a rename would have silently
carried the wrong number. Also some now-unused capability: a catalog of silver
and candles never exercises the metal-rate path. That is deliberate — it costs
nothing to keep, and the day gold is stocked it is already built and tested.

**Gained.** A schema that can represent the actual inventory, and a stated
position that pricing is a strategy per product rather than a column shape.

## The lesson worth keeping

The gold engine was the most interesting thing here to build, and it was
_specialisation as a virtue_ right up until the specialisation was wrong. Ten
minutes reading the real storefront caught what no amount of internal
consistency would have: the schema was elegantly, thoroughly modelling the wrong
business.
