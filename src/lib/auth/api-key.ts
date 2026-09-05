import 'server-only';

import { and, eq, isNull, or, gt } from 'drizzle-orm';

import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { generateToken, hashToken } from './tokens';
import type { Permission } from './permissions';

/**
 * Machine credentials, for a POS terminal or a storefront build job.
 *
 * Format: `lpe_<prefix>_<secret>`. The prefix is public and indexed; the secret
 * is 256 bits and only its SHA-256 lands in the database.
 *
 * The prefix exists so a leaked key is *identifiable* without being usable —
 * GitHub's secret scanner, a log line, or an incident responder can say "key
 * lpe_a1b2c3d4 leaked, revoke it" without anyone ever holding the secret.
 */

const PREFIX_BYTES = 6; // → 8 base64url characters
const KEY_PATTERN = /^lpe_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{20,})$/;

export type IssuedApiKey = { id: string; key: string; prefix: string };

export async function createApiKey(input: {
  name: string;
  scopes: Permission[];
  createdBy: string;
  expiresAt?: Date;
}): Promise<IssuedApiKey> {
  const prefix = generateToken(PREFIX_BYTES);
  const secret = generateToken();
  const key = `lpe_${prefix}_${secret}`;

  const [row] = await db
    .insert(apiKeys)
    .values({
      name: input.name,
      prefix,
      keyHash: hashToken(key),
      scopes: input.scopes,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: apiKeys.id });

  // Returned exactly once. There is no path to recover it afterwards, by design.
  return { id: row!.id, key, prefix };
}

export type ApiKeyIdentity = { id: string; name: string; scopes: string[] };

export async function validateApiKey(key: string | null): Promise<ApiKeyIdentity | null> {
  if (!key) return null;

  const match = KEY_PATTERN.exec(key);
  if (!match) return null;

  const [, prefix] = match;
  const now = new Date();

  const [row] = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyHash: apiKeys.keyHash,
      scopes: apiKeys.scopes,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.prefix, prefix as string),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!row) return null;
  // Compare the hash of the whole key, not just the looked-up prefix.
  if (row.keyHash !== hashToken(key)) return null;

  // Drizzle builders are lazy: without awaiting, this update never executes.
  await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));

  return { id: row.id, name: row.name, scopes: row.scopes };
}
