# Architecture Decision Records

Short notes on the choices that were not obvious, written at the time they were
made. Each one states the decision, the alternatives that were actually
considered, and the cost being accepted — so that a future maintainer (or a
reviewer asking "why not just…") gets the reasoning rather than an archaeology
exercise.

| #                                         | Decision                                        | Status   |
| ----------------------------------------- | ----------------------------------------------- | -------- |
| [0001](0001-nextjs-route-handlers.md)     | Next.js Route Handlers as the API layer         | Accepted |
| [0002](0002-postgres-everywhere.md)       | Postgres in every environment, PGlite locally   | Accepted |
| [0003](0003-sessions-over-jwt.md)         | Opaque server-side sessions, not JWTs           | Accepted |
| [0004](0004-drizzle-over-prisma.md)       | Drizzle over Prisma                             | Accepted |
| [0005](0005-integer-money-and-weights.md) | Integers only for money, metal and stones       | Accepted |
| [0006](0006-price-is-a-computation.md)    | Price is a computation, not a column            | Accepted |
| [0007](0007-postgres-fts.md)              | Postgres full-text search, not a search service | Accepted |
