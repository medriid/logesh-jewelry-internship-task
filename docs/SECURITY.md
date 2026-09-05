# Security

Every control below exists because of a specific attack. Where a control is not
yet implemented it is marked _planned_ — a security document that overstates
what is running is worse than none.

## What is actually being protected

Not customer data: there are no customer accounts and no payment processing.
The assets are:

1. **Write access to the catalog.** An attacker who can edit products can change
   a price to ₹1, publish defamatory copy under the brand's name, or quietly
   mark ₹40 lakh of inventory out of stock.
2. **Admin credentials**, which are the route to the above.
3. **Availability.** A catalog that is down during Dhanteras is the year's
   revenue.

Public read access is not a threat — the catalog is meant to be read.

## Authentication

| Control                                                                | Reason                                                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Argon2id**, 19 MiB / t=2 / p=1 (OWASP 2024 floor), per-user salt     | Memory-hard, so GPU and ASIC cracking of a leaked hash is expensive rather than trivial.                                                              |
| Cost parameters stored **inside** each PHC string                      | Raising the cost later does not invalidate existing hashes; login re-hashes transparently on next success.                                            |
| **Opaque 256-bit session tokens**; only their SHA-256 digest is stored | A full dump of `sessions` grants nothing — the attacker would need to invert SHA-256 to mint a cookie. See [ADR 0003](adr/0003-sessions-over-jwt.md). |
| `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`       | `__Host-` makes the cookie un-settable by a subdomain, which defeats subdomain cookie-fixation. `HttpOnly` keeps it out of reach of XSS.              |
| **Idle expiry + absolute expiry**                                      | A sliding window alone lets a stolen cookie be renewed forever. The absolute ceiling is set at login and cannot be extended.                          |
| Constant-time dummy hash for unknown accounts                          | Without it, response timing reveals which email addresses are real.                                                                                   |
| Identical error text for wrong-user and wrong-password                 | Same reason, via the response body.                                                                                                                   |
| Per-account lockout with backoff, **not** per-IP alone                 | The realistic attack is a botnet rotating IPs against one known admin address.                                                                        |
| `passwordChangedAt` invalidates prior sessions                         | "Change my password" must mean "log the attacker out".                                                                                                |
| API keys: `lpe_<prefix>_<secret>`, SHA-256 stored, scoped, expiring    | The clear-text prefix makes a leaked key identifiable in a log or a secret-scan without the key being recoverable from the table.                     |

## Authorisation

Roles are `READONLY < STAFF < MANAGER < OWNER`. Permissions are **not** stored
per user; they are derived from an explicit matrix in `src/lib/auth/permissions.ts`,
so "what can a MANAGER do" has exactly one answer, in one file, testable in
isolation.

Routes **declare** the permission they need. A route that declares nothing is
rejected by the handler wrapper rather than defaulting to public — fail closed,
because the failure mode of fail-open is an unauthenticated `DELETE`.

## Input handling

- **Zod on every boundary** — params, query, body — in strict mode, so unknown
  keys are rejected rather than silently ignored. An ignored key is how mass
  assignment happens.
- **Parameterised queries only.** Drizzle emits bind parameters; there is no
  string interpolation into SQL anywhere. The search endpoint passes user text to
  `websearch_to_tsquery`, which is a parser, not a concatenation.
- **Body size caps** before parsing, so a 2 GB JSON body is a 413 rather than an
  OOM.
- **Output through explicit DTO mappers.** Handlers never return a row. This is
  the control that prevents `passwordHash` from appearing in a response six
  months from now when somebody adds a join.

## Transport and browser controls

Set in `next.config.ts`, except CSP, which carries a per-request nonce and is
set in `src/middleware.ts`:

| Header                                            | Value                                                          |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `Strict-Transport-Security`                       | `max-age=63072000; includeSubDomains; preload`                 |
| `Content-Security-Policy`                         | nonce-based; no `unsafe-inline`, no `unsafe-eval` _(planned)_  |
| `X-Content-Type-Options`                          | `nosniff`                                                      |
| `X-Frame-Options` / `frame-ancestors`             | `DENY` — clickjacking a "delete product" button is a real risk |
| `Referrer-Policy`                                 | `strict-origin-when-cross-origin`                              |
| `Permissions-Policy`                              | every powerful feature denied                                  |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin`                                                  |

CORS is an exact-match allowlist from `CORS_ALLOWED_ORIGINS` plus `APP_URL`.
No wildcards, and credentials are never permitted with a wildcard origin.

## CSRF

Cookie authentication is ambient — the browser attaches it whether or not the
request was intended. `SameSite=Lax` covers most of it, but not same-site
subdomain attacks and not older clients, so unsafe methods additionally require a
double-submit token HMAC-bound to the session with `APP_SECRET`.

API-key requests are exempt: a key is not ambient, so a hostile page cannot cause
one to be sent.

## Rate limiting

Sliding window, keyed by identity where authenticated and by IP where not, with
separate budgets per route class — login is far tighter than product reads.

Backed by Upstash Redis in production. `src/config/env.ts` **refuses to boot** a
production instance without it, because the in-memory fallback is per-instance
and serverless scale-out would silently leave login unthrottled. That is the kind
of failure that is invisible until it matters, so it is a boot error.

## Data handling

- **IP addresses are stored as HMAC-SHA256**, never raw. Enough to notice a
  session that jumped countries; not a personal-data liability.
- **Logs are redacted through an allowlist**, not a denylist. New fields are
  redacted by default rather than leaking until someone notices.
- **Audit rows share the transaction** with the change they describe. A change
  that succeeded is a change that is logged; a logging failure rolls the change
  back.
- **Soft deletes and an append-only stock ledger** mean recovery from a bad
  actor or a bad script is a query, not a restore.

## Uploads

Images go **directly from the browser to Cloudinary**, using a short-lived
signature minted by an admin-only endpoint. Bytes never transit this server, so
there is no image-parsing attack surface here at all. `next.config.ts` pins an
allowlist of remote hosts — `/_next/image` is a server-side fetcher, and an open
one is an SSRF primitive.

## Supply chain

`npm audit --audit-level=high` in CI, Dependabot, and CodeQL. Exactly one
security-critical dependency is hand-picked rather than defaulted:
`@noble/hashes` for Argon2id — pure TypeScript, independently audited, no native
build step, so it cannot silently fall back to a weaker path on a host without
build tools.

## Status

|             |                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented | Env validation with production invariants · static security headers · database-level invariants · `server-only` boundary · ESLint enforcement of the `process.env` boundary |
| Planned     | Argon2id + session issuance · CSRF · rate limiting · permission matrix · audit writer · nonce CSP · signed uploads                                                          |

## Reporting

Open a GitHub issue for anything non-sensitive. For anything exploitable, contact
the maintainer privately rather than filing publicly.
