import 'server-only';

import { randomUUID } from 'node:crypto';

/** Per-request facts derived once and passed down, never re-derived. */
export type RequestContext = {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
  method: string;
  path: string;
};

/**
 * Client IP.
 *
 * Behind Vercel this is `x-forwarded-for`, whose leftmost entry is the client
 * and whose remaining entries are proxies. It is trivially spoofable in general
 * — anyone can send the header — but on Vercel the platform overwrites it, so
 * the leftmost value is trustworthy *here* and would not be on a self-hosted
 * box behind an arbitrary proxy. Worth knowing before this moves hosts.
 *
 * Used for rate limiting and for a keyed hash in the audit trail, never for
 * authorisation.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip');
}

export function buildContext(request: Request): RequestContext {
  const url = new URL(request.url);
  return {
    // Honour an inbound id so a trace spans services, but only if it looks
    // sane — an unbounded client-controlled string ends up in every log line.
    requestId: sanitizeRequestId(request.headers.get('x-request-id')) ?? randomUUID(),
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    origin: request.headers.get('origin'),
    method: request.method.toUpperCase(),
    path: url.pathname,
  };
}

function sanitizeRequestId(value: string | null): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}
