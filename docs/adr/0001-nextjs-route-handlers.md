# 0001 — Next.js Route Handlers as the API layer

**Status:** Accepted · **Date:** 2026-09-05

## Context

The brief asks for a product catalog API with CRUD, search, and admin auth, on
any stack, deployed on a free tier. It also asks for something a reviewer can
look at and understand quickly.

## Decision

One Next.js application. The API is a set of Route Handlers under
`src/app/api/v1/`; the admin console and the public storefront are React Server
Components in the same project, calling the same service layer.

## Alternatives considered

**A separate Express/Fastify service plus a separate frontend.** Cleaner
separation on paper. In practice it means two deployments, two dependency trees,
two CI pipelines, CORS between them, and a shared-types package that drifts. For
a catalog of this size that is ceremony, not architecture.

**Pure JSON API, no UI.** Literally what was asked. Rejected because "here is a
curl command" is a worse five-minute review than "here is a login, click around",
and the brief explicitly weighs how well the work fits the brand.

## Consequences

**Accepted cost.** Coupling. If the storefront ever needs to scale independently
of the admin console, this becomes one deployment doing two jobs. The mitigation
is that no route handler contains business logic — everything lives in
`src/server/services/`, which has no Next.js imports and would lift out whole.

**Gained.** One deploy, one `.env`, one type system end to end. The admin UI
consumes the same validated schemas the API does, so a field added to a Zod
schema shows up in both places or neither.
