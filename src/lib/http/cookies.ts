import type { csrfCookieAttributes } from '@/lib/auth/csrf';
import type { CookieAttributes } from '@/lib/auth/session';

/** Shared by login and sliding session renewal. */
export function serializeCookie(
  c: CookieAttributes | ReturnType<typeof csrfCookieAttributes>,
): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path}`, 'SameSite=Lax'];
  if (c.httpOnly) parts.push('HttpOnly');
  if (c.secure) parts.push('Secure');
  if ('expires' in c && c.expires) parts.push(`Expires=${c.expires.toUTCString()}`);
  return parts.join('; ');
}
