import { timingSafeEqual } from 'node:crypto';

import { generateToken, hmac } from './tokens';

/**
 * CSRF protection for cookie-authenticated writes.
 *
 * `SameSite=Lax` already blocks cross-site POSTs in every browser that honours
 * it, so why bother? Because Lax is a browser-side control and this is a
 * server-side one, and they fail differently:
 *
 *   • "Same site" is registrable-domain scope, not origin. Anything on a
 *     sibling subdomain is same-site, so a compromised subdomain can still
 *     forge a request.
 *   • Some clients and embedded webviews handle SameSite inconsistently.
 *   • A future CORS relaxation would silently remove the only protection.
 *
 * Design is double-submit, HMAC-bound to the session. The token is
 * `<random>.<hmac(sessionId:random)>`, handed out in a readable cookie and
 * echoed in a header. An attacker cannot forge the HMAC without APP_SECRET, and
 * cannot read the cookie cross-origin to replay it. Binding to the session id
 * is what stops a token minted for one session being used against another —
 * the flaw in naive double-submit.
 *
 * Stateless by construction: no server storage, nothing to expire or clean up.
 */

export const CSRF_COOKIE = 'loupe_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Methods that cannot change state, and so need no token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase());

export function issueCsrfToken(sessionId: string): string {
  const nonce = generateToken(16);
  return `${nonce}.${hmac(`${sessionId}:${nonce}`)}`;
}

export function verifyCsrfToken(sessionId: string, token: string | null | undefined): boolean {
  if (!token) return false;

  const separator = token.indexOf('.');
  if (separator <= 0) return false;

  const nonce = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = hmac(`${sessionId}:${nonce}`);

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Readable by JavaScript on purpose — the front end has to send it back in a
 * header, which is precisely what a cross-origin attacker cannot do. Secrecy is
 * not what protects it; the HMAC is.
 */
export function csrfCookieAttributes(token: string, secure: boolean) {
  return {
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    secure,
    sameSite: 'lax' as const,
    path: '/',
  };
}
