import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '@/config/env';

/**
 * Token primitives shared by sessions, API keys and CSRF.
 *
 * The pattern throughout: generate high-entropy random bytes, hand the caller
 * the token, and persist only its SHA-256 digest. A dump of the database then
 * grants nothing, because inverting SHA-256 is the attacker's problem.
 *
 * Plain SHA-256 is correct here and Argon2 would be wrong. Slow hashing exists
 * to compensate for low-entropy human passwords; a 256-bit random token has no
 * guessable structure to attack, so the only thing a KDF would add is latency
 * on every authenticated request.
 */

const TOKEN_BYTES = 32; // 256 bits

/** URL- and cookie-safe, no padding. */
export function generateToken(bytes: number = TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Compare two hex digests without leaking their contents through timing. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Keyed hash of a client IP.
 *
 * Stored instead of the address itself. Enough to notice that a session
 * suddenly moved continents; not a pile of personal data waiting to be
 * subpoenaed or leaked. Keyed rather than plain-hashed because the IPv4 space
 * is small enough to brute-force a bare SHA-256 in seconds.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', env.APP_SECRET).update(ip).digest('hex').slice(0, 32);
}

export function hmac(value: string): string {
  return createHmac('sha256', env.APP_SECRET).update(value).digest('base64url');
}
