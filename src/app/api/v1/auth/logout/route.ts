import { clearedCookie, revokeSession } from '@/lib/auth/session';
import { defineRoute } from '@/lib/http/handler';
import { noContent } from '@/lib/http/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = defineRoute({ auth: 'session', limit: 'auth' }, async ({ actor }) => {
  if (actor.kind !== 'ADMIN') throw new Error('unreachable: session required');

  // Revoked server-side, not merely cleared client-side. Clearing the cookie
  // alone leaves the session valid for anyone who captured it.
  await revokeSession(actor.session.id);

  const c = clearedCookie();
  return noContent({
    'Set-Cookie': `${c.name}=; Path=/; SameSite=Lax; HttpOnly${c.secure ? '; Secure' : ''}; Expires=${new Date(0).toUTCString()}`,
  });
});
