import { env } from '@/config/env';

/**
 * CORS.
 *
 * An exact-match allowlist, echoing the request's own origin when it is on the
 * list. Never `*`: this API sets credentialed cookies, and the spec forbids
 * `*` with credentials for exactly that reason — a wildcard would let any site
 * read authenticated responses.
 */
const allowed = (): string[] => [env.APP_URL, ...env.CORS_ALLOWED_ORIGINS];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // same-origin and server-to-server send no Origin
  return allowed().includes(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    // Vary, or a CDN caches one origin's response and serves it to another.
    Vary: 'Origin',
  };
}

export function preflightHeaders(origin: string | null): Record<string, string> {
  return {
    ...corsHeaders(origin),
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key, If-Match',
    'Access-Control-Max-Age': '600',
  };
}
