# Deployment

Vercel + Neon, both free tier. Roughly ten minutes.

## 1. Database

Create a project at [neon.tech](https://neon.tech) and copy the **pooled**
connection string — the one with `-pooler` in the host.

It matters: Vercel functions are numerous and short-lived, and the pooled
endpoint runs pgbouncer in transaction mode so they do not exhaust the
connection limit. `src/db/index.ts` already sets `prepare: false`, which that
mode requires.

## 2. Rate-limit store

Create a Redis database at [upstash.com](https://upstash.com) and copy the REST
URL and token.

Not optional. `src/config/env.ts` **refuses to boot** a production instance
without it: the in-memory fallback is per-instance, so across serverless
scale-out it would leave login effectively unthrottled — a failure that is
invisible until someone is brute-forcing an admin account.

## 3. Environment

Set these in Vercel → Settings → Environment Variables:

```
NODE_ENV=production
APP_URL=https://<your-deployment>.vercel.app
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://…-pooler…/neondb?sslmode=require
APP_SECRET=<openssl rand -base64 48>
UPSTASH_REDIS_REST_URL=https://….upstash.io
UPSTASH_REDIS_REST_TOKEN=…
LOG_LEVEL=info
```

`env.ts` enforces on boot that production uses `https`, real Postgres, and a
shared rate-limit store. A misconfigured deploy fails loudly at startup instead
of running in a degraded state.

## 4. Migrate and seed

```bash
DATABASE_DRIVER=postgres DATABASE_URL='<pooled url>' npm run db:migrate
DATABASE_DRIVER=postgres DATABASE_URL='<pooled url>' \
  SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<strong>' npm run db:seed
```

Change the seeded password immediately after first login.

## 5. Deploy

```bash
vercel --prod
```

Build command is the default `npm run build`. No `postinstall` step is needed —
Drizzle generates no client.

## Verify

```bash
curl -s https://<deployment>/api/v1/health | jq
curl -sI https://<deployment>/ | grep -i -e strict-transport -e content-security -e x-frame
```

`/api/v1/health` reports liveness and whether migrations are current.

## Cost

|              | Free tier           | Headroom                             |
| ------------ | ------------------- | ------------------------------------ |
| Vercel Hobby | 100 GB bandwidth/mo | Comfortable for a catalog            |
| Neon Free    | 0.5 GB storage      | A few thousand products is megabytes |
| Upstash Free | 10k commands/day    | Rate-limit checks only               |

Neon's free tier suspends a project after inactivity, so the first request after
an idle period pays a cold start of a second or two. Acceptable for a demo; on a
paid tier it disappears.

## Other hosts

Nothing here is Vercel-specific. The app is a standard Next.js server and runs on
Fly, Railway, Render, or a container — set the same environment variables and run
`npm run build && npm start`. Docker Compose for local Postgres is in the repo if
you prefer it to PGlite.
