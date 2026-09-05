# 0005 — Integers only for money, metal and stones

**Status:** Accepted · **Date:** 2026-09-05

## Context

A gold catalog multiplies a per-gram rate by a weight, adds a percentage, adds a
flat amount, applies a discount, then adds tax. Five operations on quantities
that are conventionally written with decimals.

## Decision

No floating point and no `numeric` anywhere in the schema or the API. Every
physical and monetary quantity is an integer in its smallest meaningful unit:

| Quantity           | Unit         | Example                     |
| ------------------ | ------------ | --------------------------- |
| Money              | paise        | `₹1,04,857.35` → `10485735` |
| Metal weight       | milligrams   | `18.4 g` → `18400`          |
| Stone weight       | points       | `0.75 ct` → `75`            |
| Rates, percentages | basis points | `3%` → `300`                |

Rounding happens exactly once, at the end of the pricing calculation, using
banker's-adjacent half-up on the final paise value.

## Rationale

**Floats are simply wrong here.** `0.1 + 0.2 !== 0.3`. Applied to a ₹1.4 lakh
necklace across five operations, the error is small but real, non-deterministic
across engines, and it lands in a number a customer compares against a receipt.

**`numeric` is right but leaks.** Postgres `numeric` is exact. It arrives in
JavaScript as a _string_, because it can exceed `Number.MAX_SAFE_INTEGER` — so
somewhere, someday, someone writes `parseFloat(product.price)` and the exactness
was theatre. An integer is exact in the database _and_ in JavaScript.

**The units are already integral in the trade.** Gold is quoted to three decimal
grams — milligrams. Diamonds are quoted in points, and "points" is the word
jewellers actually use. Basis points are how rates are written in finance. This
is not an encoding trick imposed on the domain; it is the domain's own units.

**Range is not a concern.** `Number.MAX_SAFE_INTEGER` is ~9.007 × 10¹⁵ paise, or
about ₹90 trillion. A jewellery catalog will not reach it.

## Consequences

**Accepted cost.** Every boundary must convert. `₹` in, paise stored; paise out,
`₹` rendered. Getting that wrong by a factor of 100 is now the failure mode — so
conversion lives in exactly two functions (`toMinor` / `formatMoney` in
`src/lib/pricing/money.ts`), API fields are named with their unit
(`fixedPricePaise`, `netMetalWeightMg`), and the money helpers are unit-tested
including the rounding boundaries.

**Gained.** The pricing engine is pure integer arithmetic. Its output is
bit-identical on every machine, in every environment, forever — which is what
lets a quote from last Tuesday be reproduced exactly during a dispute.
