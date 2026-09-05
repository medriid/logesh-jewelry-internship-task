# Architecture

## Shape

One Next.js application. Four layers, and the dependency arrows only ever point
downward.

```
  src/app/(storefront)      src/app/admin          src/app/api/v1
  public catalog UI         admin console          versioned REST
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 ▼
                        src/server/services/
         business rules · transactions · audit · authorisation
                                 ▼
              src/lib/            +        src/db/
   pricing · search · auth              schema · migrations
   http · ratelimit · logging           Drizzle · Postgres
```

**Route handlers contain no business logic.** They parse, authorise, delegate,
and serialise. Every rule — how a price is computed, when stock may be
decremented, what a MANAGER may edit — lives in `src/server/services/`, which
imports nothing from Next.js. That is what makes the ADR-0001 trade-off
(one deployment doing two jobs) reversible: the service layer would lift into a
standalone process without edits.

Both modes converge on the same tax step, so `taxableValue + tax === total`
holds by construction rather than by two code paths agreeing.

**The UI is a client of the API, not a shortcut past it.** Server Components
call the same service functions the route handlers do, so there is no path where
the admin console can write something the API would have rejected.

## Layout

```
src/
  app/
    (storefront)/     public catalog — Server Components
    admin/            admin console — login, CRUD, stock, audit
    api/v1/           versioned REST route handlers
    docs/             OpenAPI reference (Scalar)
    icon.svg globals.css
  config/
    env.ts            Zod-validated environment. Parsed once, at boot.
    brand.ts          the only place brand identity lives
  db/
    index.ts          driver selection: PGlite or Postgres
    schema/           14 tables across 7 modules
  lib/
    auth/             argon2, sessions, CSRF, API keys, permission matrix
    pricing/          the metal-rate engine and money helpers
    search/           tsquery construction, filters, cursor pagination
    http/             problem+json, envelopes, the handler wrapper
    ratelimit/        Upstash adapter + in-memory adapter
    validation/       Zod schemas, shared by API and admin forms
    observability/    structured logging with redaction, audit writer
  server/
    services/         business rules — no Next.js imports
    repositories/     query composition
drizzle/              generated SQL migrations
tests/                unit + integration (integration boots real Postgres)
docs/adr/             7 decision records
```

## Request path

Every API request goes through the same pipeline, assembled once in
`src/lib/http/handler.ts` so no route can forget a step:

1. **Security headers + CSP nonce** — `src/middleware.ts`, before anything else.
2. **Correlation ID** — generated or taken from `X-Request-Id`; threaded through
   logs and the audit row, returned on the response.
3. **Rate limit** — per route class and per identity.
4. **Authenticate** — session cookie or API key. Never both.
5. **Authorise** — explicit permission matrix, checked against the route's
   declared requirement. A route with no declared requirement fails closed.
6. **CSRF** — required for cookie-authenticated unsafe methods. API keys are
   exempt because they are not ambient credentials.
7. **Validate** — Zod, in strict mode, on params, query and body.
8. **Idempotency** — if `Idempotency-Key` is present, replay or reserve.
9. **Delegate** — one service call, inside one transaction.
10. **Serialise** — through an explicit DTO mapper, never by returning a row.

Step 10 is not ceremony. Returning a database row directly is how
`passwordHash` ends up in a JSON response after somebody adds a join.

## Data flow: computing a price

The one path worth tracing, because it explains the schema.

```
GET /api/v1/products/kundan-temple-choker
        │
        ├── repository: load product + variants + images   (1 query)
        ├── repository: latest rate for (GOLD, 916)         (1 query, cached ~5 min)
        │                                                    — skipped for FIXED products
        └── pricing/engine.ts — a pure function, no I/O:

    FIXED (most of the catalog)        METAL_RATE (solid gold)
    ───────────────────────────        ────────────────────────────────────────
    gross = sellingPrice               metal    = rate × netWeight
    mrp   = compareAt (optional)       wastage  = metal × wastage%
    off%  = derived, floored           making   = perGram | %ofMetal | flat
                                       −disc    = making × discount%
                                       stones   = flat
                                       gross    = sum of the above
    ───────────────────────────────────────────────────────────────────────────
    then, identically for both:
      inclusive  → base = gross × 10000/(10000+rate);  tax = gross − base
      exclusive  → base = gross;  tax = base × rate;   total = base + tax
```

Two queries for a page, regardless of how many products are on it: the rate is
fetched once and applied to all of them. The engine takes a product and a rate
and returns a breakdown — no database handle, no clock, no config lookup — which
is why it can be exhaustively unit-tested and why a past quote can be reproduced
by passing a past rate.

## Boundaries that are enforced, not documented

| Rule                                     | Enforced by                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Only `config/env.ts` reads `process.env` | ESLint `no-restricted-properties`                                      |
| Stock never goes negative                | Postgres `CHECK`                                                       |
| Stock never changes without a ledger row | single writer in `services/inventory.ts`, inside one transaction       |
| A price is never stored                  | there is no price column to store it in                                |
| Client bundles never import the database | `server-only`                                                          |
| A mutation is never unlogged             | audit write shares the transaction; a failed log rolls the change back |

## What this deliberately does not have

An event bus, a cache layer beyond the in-process rate cache, a job queue, a
read replica, CQRS. A catalog of a few thousand pieces with a handful of staff
writing to it does not need any of them, and each one would be a component to
secure, deploy and explain. [ADR 0007](adr/0007-postgres-fts.md) names the point
at which the search assumption stops holding; the same instinct applies to the
rest.
