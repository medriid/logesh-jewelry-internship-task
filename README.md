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

The table below is the target API. Authentication (`/auth/login`, `/auth/logout`,
`/auth/session`) and `/health` are implemented; catalog, search, stock and
metal-rate routes are still planned.

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

Schema, migrations, the pure pricing engine, authentication and health routes are
implemented. Authentication includes server-side session renewal, CSRF protection,
rate limiting and atomic account lockout. Health checks detect missing migrations.
Regression tests cover streamed request limits, browser session cookies, CORS,
concurrent login failures and account changes during login.

Catalog CRUD, search, inventory and metal-rate endpoints, API reference, storefront
and admin UI remain to be built. The Run section's UI URLs describe those planned
screens; only the implemented API routes are currently available.
