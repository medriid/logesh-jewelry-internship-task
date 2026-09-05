# 0003 — Opaque server-side sessions, not JWTs

**Status:** Accepted · **Date:** 2026-09-05

## Context

Admin authentication for a catalog that a handful of staff can modify. The
default reflex in a Next.js project is a signed JWT in a cookie.

## Decision

Opaque session tokens with server-side state.

- The token is 32 bytes from a CSPRNG, base64url-encoded. It carries no claims.
- The database stores only its **SHA-256 digest** as the primary key of
  `sessions`. The token itself is never written down anywhere.
- Cookie is `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Two clocks: a sliding idle expiry, and an absolute expiry fixed at login.

## Rationale

**Revocation is the whole argument.** "Log this session out, now" is a `UPDATE`.
With a JWT it is either impossible until expiry, or you build a denylist — at
which point you are doing a database read on every request anyway, and have a
stateless token with stateful storage: the worst of both.

**A database dump grants nothing.** Session rows contain a SHA-256 digest. An
attacker with a full copy of the table cannot mint a working cookie without
inverting SHA-256. A leaked JWT signing key, by contrast, forges every session
that ever existed, including admin ones.

**No signature to get wrong.** The `alg: none` family of vulnerabilities, key
confusion, library-specific verification bugs — none apply to a random string
compared against a stored hash in constant time. Hashing is fast because the
input is already 256 bits of entropy; it is a lookup key, not a password.

**We are already hitting the database.** Every admin request loads the user's
role. The "stateless" saving was notional.

## Alternatives considered

**JWT with short expiry + refresh token.** Adds a rotation protocol, a refresh
endpoint, and reuse-detection logic — real complexity, all of it in the security
path, to solve a problem (database round-trips) this application does not have.

**NextAuth / Auth.js.** A reasonable default, and for OAuth it would win outright.
Here it brings an adapter layer and its own schema for one email-and-password
form, and it makes "explain your auth" a walk through someone else's library.

## Consequences

**Accepted cost.** One indexed primary-key lookup per authenticated request. Sub-
millisecond, and it is the same query that fetches the role. Sessions must also
be swept; expired rows are deleted by a scheduled job rather than accumulating.

**Gained.** Instant revocation, per-session visibility ("your active sessions"),
forced logout on password change via `passwordChangedAt`, and an auth model that
fits on one page.
