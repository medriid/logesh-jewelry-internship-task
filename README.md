<img src="public/brand/wordmark.svg" alt="Loupe" width="200">

Product catalog API and admin console for a hallmarked-gold jewellery brand.

Gold has no fixed price — a 22K chain is repriced every morning against the
bullion rate, so a `price` column is wrong by lunchtime. This API stores the
inputs (net metal weight, purity, making charge, wastage, GST) and computes the
price, itemised, from the day's rate.

## Run

```bash
npm install
cp .env.example .env.local        # set APP_SECRET: openssl rand -base64 48
npm run db:migrate && npm run db:seed
npm run dev
```

No Docker, no database to provision — Postgres runs in-process via PGlite.
Storefront at `/`, admin at `/admin`, API reference at `/docs`.

```bash
npm run verify        # typecheck + lint + tests
```

## API

`/api/v1` · errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
problem documents · money is always integer **paise**.

|                    |                                                                       |
| ------------------ | --------------------------------------------------------------------- |
| `GET POST`         | `/products` — list with filters, sort, cursor paging · create         |
| `GET PATCH DELETE` | `/products/{id}` — detail with price breakdown · update · soft delete |
| `POST GET`         | `/products/{id}/stock` — ledger movement · history                    |
| `GET`              | `/search?q=` — weighted full-text with facets                         |
| `GET POST`         | `/metal-rates` — today's rate · publish a new one                     |
| `POST`             | `/auth/login` · `/auth/logout`                                        |
| `GET`              | `/health`                                                             |

Writes require admin auth. `PATCH` requires `If-Match`. `POST` accepts
`Idempotency-Key`.

## Stack

Next.js 16 · TypeScript (strict) · Drizzle · Postgres · Zod · Vitest

## Docs

[Architecture](docs/ARCHITECTURE.md) ·
[Security](docs/SECURITY.md) ·
[Data model](docs/DATA-MODEL.md) ·
[Decisions](docs/adr/) ·
[Brand](docs/BRAND.md) ·
[Deployment](docs/DEPLOYMENT.md)

## Status

Schema, migrations and constraints are done — 14 tables, 18 CHECK constraints,
11 integration tests passing against real Postgres. Pricing engine, auth, route
handlers and UI are in progress.
