import { permissionsFor } from '@/lib/auth/permissions';
import { defineRoute } from '@/lib/http/handler';
import { ok } from '@/lib/http/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who am I? Used by the admin shell to decide what to render. */
export const GET = defineRoute({ auth: 'session', limit: 'auth' }, async ({ actor, ctx }) => {
  // `auth: 'session'` guarantees this narrowing; the check keeps the compiler
  // honest rather than reaching for a non-null assertion.
  if (actor.kind !== 'ADMIN') throw new Error('unreachable: session required');

  return ok(
    {
      user: { ...actor.session.user, permissions: permissionsFor(actor.session.user.role) },
      expiresAt: actor.session.expiresAt.toISOString(),
      absoluteExpiresAt: actor.session.absoluteExpiresAt.toISOString(),
    },
    { requestId: ctx.requestId },
  );
});
