import 'server-only';

import { auditLogs } from '@/db/schema';
import { hashIp } from '@/lib/auth/tokens';
import type { Database } from '@/db';
import type { Actor } from '@/lib/http/handler';
import type { RequestContext } from '@/lib/http/context';

/**
 * The audit trail.
 *
 * Written with the *transaction handle* of the change it describes, not with a
 * fresh connection — so a change that commits is a change that is logged, and a
 * failed log rolls the change back. Fire-and-forget logging is how you end up
 * with gaps in exactly the window you care about.
 */

/** Never written to the audit trail, whatever the caller passes. */
const REDACTED_FIELDS = new Set(['passwordHash', 'password', 'keyHash', 'token', 'secret', 'csrf']);

/**
 * Allowlist by exclusion is still a denylist, so this also drops anything whose
 * name merely *looks* secret. A new `refreshTokenHash` column should be
 * redacted the day it is added, not the day someone notices.
 */
function redact(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const secretish = REDACTED_FIELDS.has(key) || /(password|secret|token|hash|key)$/i.test(key);
    out[key] = secretish ? '[redacted]' : v;
  }
  return out;
}

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export type ActorFields = {
  actorType: 'ADMIN' | 'API_KEY' | 'SYSTEM';
  actorId: string | null;
  actorLabel: string | null;
};

/**
 * Attribution for an actor who is mid-authentication and therefore has no
 * session yet — the login event itself. Without this, logging a sign-in means
 * fabricating a session object just to satisfy a type.
 */
export function selfAttribution(user: { id: string; email: string }): ActorFields {
  return { actorType: 'ADMIN', actorId: user.id, actorLabel: user.email };
}

export function actorFields(actor: Actor): ActorFields {
  switch (actor.kind) {
    case 'ADMIN':
      return {
        actorType: 'ADMIN',
        actorId: actor.session.user.id,
        actorLabel: actor.session.user.email,
      };
    case 'API_KEY':
      return { actorType: 'API_KEY', actorId: actor.key.id, actorLabel: `key:${actor.key.name}` };
    case 'ANONYMOUS':
      return { actorType: 'SYSTEM', actorId: null, actorLabel: null };
  }
}

export async function writeAudit(
  tx: Database,
  entry: AuditEntry,
  actor: Actor | ActorFields,
  ctx: Pick<RequestContext, 'requestId' | 'ip' | 'userAgent'>,
): Promise<void> {
  // Keys are omitted rather than set to undefined: `exactOptionalPropertyTypes`
  // treats an explicit undefined as a distinct value from an absent key, and
  // storing `{"before": null}` in the audit JSON would read as "it was null"
  // rather than "there was no before".
  const before = redact(entry.before);
  const after = redact(entry.after);
  const changes = before || after ? { ...(before && { before }), ...(after && { after }) } : null;

  const attribution = 'kind' in actor ? actorFields(actor) : actor;

  await tx.insert(auditLogs).values({
    ...attribution,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes,
    ipHash: hashIp(ctx.ip),
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    requestId: ctx.requestId,
  });
}

/** Only the fields that actually changed, so the trail is readable. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [key, next] of Object.entries(after)) {
    if (next !== undefined && before[key] !== next) {
      b[key] = before[key];
      a[key] = next;
    }
  }
  return { before: b, after: a };
}
