import { csrfCookieAttributes, issueCsrfToken } from '@/lib/auth/csrf';
import { clearedCookie, type CookieAttributes } from '@/lib/auth/session';
import { permissionsFor } from '@/lib/auth/permissions';
import { defineRoute } from '@/lib/http/handler';
import { problem, problemResponse } from '@/lib/http/problem';
import { ok } from '@/lib/http/responses';
import { loginSchema } from '@/lib/validation/auth';
import { login } from '@/server/services/auth';
import { hashToken } from '@/lib/auth/tokens';
import { isProduction } from '@/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Serialise cookie attributes into a Set-Cookie value. */
function setCookie(c: CookieAttributes | ReturnType<typeof csrfCookieAttributes>): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path}`, `SameSite=Lax`];
  if (c.httpOnly) parts.push('HttpOnly');
  if (c.secure) parts.push('Secure');
  if ('expires' in c && c.expires) parts.push(`Expires=${c.expires.toUTCString()}`);
  return parts.join('; ');
}

export const POST = defineRoute(
  {
    auth: 'public',
    // The tightest budget in the app. Five attempts a minute per address.
    limit: 'login',
    body: loginSchema,
    // A login body is two short strings; anything larger is not a login.
    maxBodyBytes: 4 * 1024,
  },
  async ({ body, ctx }) => {
    const result = await login(body, ctx);

    if (!result.ok) {
      // One message for every failure — wrong password, unknown address,
      // suspended, locked. See src/server/services/auth.ts.
      return problemResponse(
        problem('unauthenticated', {
          requestId: ctx.requestId,
          detail: 'Invalid email or password.',
        }),
        // Clear any stale cookie so a failed login cannot leave a half-state.
        { 'Set-Cookie': setCookie(clearedCookie()) },
      );
    }

    const { session, user } = result.value;
    // The CSRF token binds to the session *id* — the digest that is stored —
    // not to the raw token the browser holds.
    const csrfToken = issueCsrfToken(hashToken(session.token));

    const headers = new Headers();
    headers.append('Set-Cookie', setCookie(session.cookie));
    headers.append('Set-Cookie', setCookie(csrfCookieAttributes(csrfToken, isProduction)));

    return ok(
      {
        user: { ...user, permissions: permissionsFor(user.role) },
        expiresAt: session.expiresAt.toISOString(),
        // Also in the body, so a fetch client can read it without parsing
        // document.cookie.
        csrfToken,
      },
      { requestId: ctx.requestId },
      headers,
    );
  },
);
