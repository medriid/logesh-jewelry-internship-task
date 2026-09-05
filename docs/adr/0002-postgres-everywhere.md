# 0002 — Postgres in every environment, PGlite locally

**Status:** Accepted · **Date:** 2026-09-05

## Context

A reviewer's first act is `git clone`. Anything between that and a running app —
install Docker, create a Neon account, wait for a database to provision — is
attrition. But the usual fix for that, SQLite locally, means developing against
a different database from the one in production.

## Decision

Postgres everywhere. Locally and in tests it is **PGlite**: Postgres itself,
compiled to WebAssembly, running inside the Node process. In production it is a
managed Postgres (Neon). One dialect, one set of migration files.

## Alternatives considered

**SQLite locally, Postgres in production.** The traditional answer, and the
reason this schema could not use it: SQLite has no `tsvector`, no `GIN` indexes,
no partial indexes, no enums, and until recently no usable `CHECK` on altered
tables. Every invariant this schema leans on would have become "tested nowhere,
hoped for in production".

**Docker Compose.** Correct, and still supported — but it puts a 400 MB download
in front of `npm run dev`, and not every reviewer has a Docker daemon.

**Cloud database for local dev.** Requires an account and a network round-trip
per query. Tests become slow and flaky.

## Consequences

**Accepted cost.** PGlite is single-connection and not identical to a server
under concurrency, so it cannot exercise connection-pool behaviour or true
parallel-transaction races. Anything load- or concurrency-sensitive has to be
verified against real Postgres before it is believed.

**Gained.** `git clone && npm install && npm run dev` produces a working
Postgres-backed app on any machine, with no accounts and no daemons. Each test
file gets a disposable database in ~1 s, migrated from the same SQL that runs in
production — so a broken migration fails in CI rather than on deploy.
