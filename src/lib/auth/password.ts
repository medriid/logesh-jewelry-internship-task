import { randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2idAsync } from '@noble/hashes/argon2.js';

import { env } from '@/config/env';

/**
 * Password hashing — Argon2id, in the PHC string format.
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 *
 * Three decisions worth stating:
 *
 * **Argon2id, not bcrypt.** Memory-hard, so cracking a leaked hash costs RAM
 * per guess rather than just cycles. That is what makes GPU and ASIC attacks
 * expensive instead of trivial. Parameters follow the OWASP 2024 floor:
 * 19 MiB, t=2, p=1.
 *
 * **The parameters live inside the string.** Verification reads the cost the
 * hash was *created* with, so raising the cost later does not lock anyone out —
 * `needsRehash` flags the old hash and the login path upgrades it in place on
 * the next successful sign-in.
 *
 * **The async variant.** `argon2id` is ~190 ms of solid CPU; running the
 * synchronous version would block Node's event loop for that entire time, so a
 * handful of concurrent logins would stall every other request on the instance.
 * `argon2idAsync` yields between passes.
 *
 * Pure TypeScript (`@noble/hashes`, independently audited) rather than a native
 * binding: no build step means it cannot silently fall back to a weaker path on
 * a host without a compiler.
 */

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ALGORITHM = 'argon2id';
const VERSION = 19;

type Params = { m: number; t: number; p: number };

const currentParams = (): Params => ({
  m: env.ARGON2_MEMORY_KIB,
  t: env.ARGON2_ITERATIONS,
  p: env.ARGON2_PARALLELISM,
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64').replace(/=+$/, '');
const unb64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64'));

export async function hashPassword(plain: string): Promise<string> {
  const params = currentParams();
  const salt = new Uint8Array(randomBytes(SALT_BYTES));
  const hash = await argon2idAsync(new TextEncoder().encode(plain), salt, {
    ...params,
    dkLen: HASH_BYTES,
  });
  return `$${ALGORITHM}$v=${VERSION}$m=${params.m},t=${params.t},p=${params.p}$${b64(salt)}$${b64(hash)}`;
}

type Parsed = { params: Params; salt: Uint8Array; hash: Uint8Array };

function parsePhc(phc: string): Parsed | null {
  // $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
  const parts = phc.split('$');
  if (parts.length !== 6 || parts[1] !== ALGORITHM) return null;

  const version = /^v=(\d+)$/.exec(parts[2] ?? '');
  if (!version || Number(version[1]) !== VERSION) return null;

  const costs = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? '');
  if (!costs) return null;

  const [, m, t, p] = costs;
  const saltPart = parts[4];
  const hashPart = parts[5];
  if (!saltPart || !hashPart) return null;

  return {
    params: { m: Number(m), t: Number(t), p: Number(p) },
    salt: unb64(saltPart),
    hash: unb64(hashPart),
  };
}

export type VerifyResult = { valid: boolean; needsRehash: boolean };

export async function verifyPassword(plain: string, phc: string): Promise<VerifyResult> {
  const parsed = parsePhc(phc);
  // A malformed hash is a corrupt record, not a valid password. Never true.
  if (!parsed) return { valid: false, needsRehash: false };

  const computed = await argon2idAsync(new TextEncoder().encode(plain), parsed.salt, {
    ...parsed.params,
    dkLen: parsed.hash.length,
  });

  const valid =
    computed.length === parsed.hash.length &&
    timingSafeEqual(Buffer.from(computed), Buffer.from(parsed.hash));

  const current = currentParams();
  const needsRehash =
    valid &&
    (parsed.params.m < current.m || parsed.params.t < current.t || parsed.params.p < current.p);

  return { valid, needsRehash };
}

/**
 * Burn the same CPU a real verification would, for an email that does not
 * exist.
 *
 * Without this, "no such user" returns in microseconds while "wrong password"
 * takes ~190 ms, and anyone with a stopwatch can enumerate which of your
 * admins' addresses are real — the first step of a targeted attack. The login
 * handler calls this on the miss path so both branches cost the same.
 */
const DUMMY_HASH_PROMISE = hashPassword('a password that is never anyone’s');

export async function equalizeTimingForUnknownUser(attempt: string): Promise<void> {
  await verifyPassword(attempt, await DUMMY_HASH_PROMISE);
}
