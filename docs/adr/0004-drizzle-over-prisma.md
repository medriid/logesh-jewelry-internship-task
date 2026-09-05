# 0004 — Drizzle over Prisma

**Status:** Accepted · **Date:** 2026-09-05

## Context

Prisma is the default ORM choice in this ecosystem and the one most reviewers
recognise. Choosing against it needs a reason better than preference.

## Decision

Drizzle ORM.

## Rationale

**PGlite.** Drizzle has a first-class PGlite driver; Prisma does not. This single
fact decides [ADR 0002](0002-postgres-everywhere.md) — the zero-setup local
Postgres, and the disposable per-file test database, both depend on it.

**This schema is mostly constraints.** `stock_quantity >= 0`,
`reserved <= stock`, "a FIXED-price product must have a price", "exactly one of
three value columns is populated", a `GENERATED ALWAYS` weighted `tsvector`, a
`GIN` index over it, partial unique indexes for "exactly one primary image".
Prisma's schema language expresses none of these; they go in hand-written SQL
inside migration files, detached from the model they constrain — so the model
and the rule drift, and the rule is the part that matters. Drizzle declares each
one next to the table it protects, and `npm run db:generate` emits it.

**Cold start.** Prisma ships a query engine that must initialise per serverless
invocation. Drizzle is a SQL builder — no engine, no binary, no init cost.

**SQL stays visible.** The search query in `src/lib/search/` composes
`ts_rank`, `websearch_to_tsquery`, and a cursor predicate. In Drizzle that reads
like the SQL it becomes. In Prisma it would be `$queryRaw`, giving up the type
safety that was the reason to use Prisma.

## Alternatives considered

**Prisma.** Better Studio, more mature migration tooling, wider recognition.
Genuine advantages — they lose to the four points above for this schema.

**Raw SQL with a thin query helper.** Maximum control, no abstraction to fight.
Rejected: no compile-time link between a column rename and the code reading it,
which on a 36-column products table is where the bugs come from.

## Consequences

**Accepted cost.** Smaller community, and Drizzle's relational query builder is
less ergonomic than Prisma's `include` for deep nesting. Drizzle Studio is
adequate but not Prisma Studio.

**Gained.** Every database-level guarantee lives in the schema file, version-
controlled alongside the code it protects, and covered by tests that run the real
migration against real Postgres.
