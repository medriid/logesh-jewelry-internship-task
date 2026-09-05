# 0007 — Postgres full-text search, not a search service

**Status:** Accepted · **Date:** 2026-09-05

## Context

The brief asks for a search/filter endpoint. The reflex is Elasticsearch,
Meilisearch, or Algolia.

## Decision

Postgres full-text search. A `GENERATED ALWAYS` `tsvector` column on `products`,
weighted by field, with a `GIN` index over it, queried through
`websearch_to_tsquery` and ranked by `ts_rank`.

## Rationale

**The corpus is tiny.** A jewellery catalog is hundreds to low thousands of
products, each a few hundred words. A GIN index over that is sub-millisecond.
Elasticsearch is built for a problem three orders of magnitude larger.

**Search and filter are the same query.** Real usage is "polki necklaces under
₹80,000, 22K, in stock" — full-text _and_ structured predicates _and_ a live
price calculation, together. Split across two systems that becomes: query the
search service, get IDs, query Postgres for the rest, reconcile pagination
between two ranked orderings. In one database it is one `WHERE` clause.

**No synchronisation, therefore no drift.** The `tsvector` is `GENERATED`, so
Postgres maintains it inside the same transaction as the write. It cannot be
stale, cannot miss an update, and cannot need a reindex. An external index is a
second copy of the data with a pipeline that will eventually fail quietly.

**Weighting is the part that matters, and it is one line.** Name and SKU get
weight `A`, short description `B`, long description `C`. Searching "kundan"
returns the Kundan choker above a necklace that mentions kundan in paragraph
four — which is most of what "good search" means at this scale.
[Verified by test.](../../tests/integration/schema-invariants.test.ts)

**Zero operational surface.** No second service to deploy, secure, pay for, or
keep in sync. On a free tier that is not a small consideration.

## Alternatives considered

**Meilisearch / Typesense.** Better typo tolerance out of the box, genuinely
nicer relevance. Rejected for now: a second deployment and a sync pipeline for a
few hundred rows.

**`ILIKE '%term%'`.** No ranking, no stemming ("necklaces" misses "necklace"),
and a leading wildcard cannot use an index. It is kept only as a narrow fallback
for SKU-prefix lookups, where it is exactly right.

## Consequences

**Accepted cost.** No typo tolerance — `tsquery` will not match "neklace". The
mitigation is a `pg_trgm` similarity fallback when the primary query returns
nothing, which keeps the common case fast and the failure case forgiving. Also
English-only stemming: Hindi and Tamil product names are indexed as-is, matching
exactly but not stemming. For proper-noun-heavy jewellery terms ("polki",
"jhumka", "mangalsutra") this is close to a non-issue.

**Revisit when.** The catalog passes ~50,000 products, or the team wants
faceted analytics, synonyms, or per-user relevance tuning. At that point the
`tsvector` column comes out and a real search service goes in — behind
`src/lib/search/`, which is the only module that would change.
