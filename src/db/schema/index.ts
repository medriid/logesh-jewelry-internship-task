/**
 * The complete database schema.
 *
 * Drizzle reads this barrel to generate migrations, so anything not re-exported
 * here does not exist as far as `npm run db:generate` is concerned.
 *
 * Layers, in dependency order:
 *   enums       — closed value sets, enforced by Postgres
 *   auth        — operators, sessions, API keys, idempotency
 *   catalog     — categories, collections, products, variants, images
 *   attributes  — admin-defined custom fields (the extensibility layer)
 *   pricing     — historical metal rates
 *   inventory   — append-only stock ledger
 *   audit       — immutable change log
 */

export * from './enums';
export * from './auth';
export * from './catalog';
export * from './attributes';
export * from './pricing';
export * from './inventory';
export * from './audit';
