/**
 * Success responses.
 *
 * Everything is wrapped in `{ data, meta? }`. The envelope earns its keep for
 * one reason: a bare array at the top level has nowhere to put pagination, so
 * an API that returns `[...]` today needs a breaking change the first time it
 * needs a cursor. It also blocks the JSON-array hijacking class of attack
 * outright.
 */

export type Meta = {
  /** Opaque cursor for the next page; absent on the last page. */
  nextCursor?: string;
  count?: number;
  /** Echoed so a client can correlate a response with its logs. */
  requestId?: string;
  [key: string]: unknown;
};

export type Envelope<T> = { data: T; meta?: Meta };

function json<T>(data: T, status: number, meta?: Meta, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  const body: Envelope<T> = meta ? { data, meta } : { data };
  return new Response(JSON.stringify(body), { status, headers: h });
}

export const ok = <T>(data: T, meta?: Meta, headers?: HeadersInit) =>
  json(data, 200, meta, headers);

export const created = <T>(data: T, location: string, meta?: Meta) =>
  json(data, 201, meta, { Location: location });

export const noContent = (headers: HeadersInit = {}) =>
  new Response(null, { status: 204, headers });

/**
 * A public, cacheable response. `s-maxage` lets the CDN serve it while
 * `stale-while-revalidate` keeps it warm through a revalidation — appropriate
 * for catalog reads, never for anything behind auth.
 */
export const publicCache = (seconds: number, staleSeconds = seconds * 10): HeadersInit => ({
  'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`,
});
