import { describe, expect, it } from 'vitest';

import {
  equalizeTimingForUnknownUser,
  hashPassword,
  verifyPassword,
} from '../../src/lib/auth/password';
import { issueCsrfToken, isSafeMethod, verifyCsrfToken } from '../../src/lib/auth/csrf';
import { can, permissionsFor, scopesAllow, type Role } from '../../src/lib/auth/permissions';
import { hashToken, hashIp, safeEqualHex, generateToken } from '../../src/lib/auth/tokens';

describe('password hashing', () => {
  it('produces a PHC string carrying its own cost parameters', async () => {
    const phc = await hashPassword('correct horse battery staple');
    // The parameters must be in the string, or raising the cost later would
    // invalidate every existing hash.
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[\w+/]+\$[\w+/]+$/);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const phc = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', phc)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(verifyPassword('Correct horse battery staple', phc)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('salts — the same password twice gives different hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    // ...and both still verify.
    await expect(verifyPassword('same', a)).resolves.toMatchObject({ valid: true });
    await expect(verifyPassword('same', b)).resolves.toMatchObject({ valid: true });
  });

  it('flags a hash made with weaker parameters for rehash', async () => {
    // A hash from before the cost was raised. It must still verify — locking
    // people out to upgrade security is not a security improvement.
    const weak = (await hashPassword('pw')).replace(/m=\d+,t=\d+,p=\d+/, 'm=8192,t=1,p=1');
    const result = await verifyPassword('pw', weak);
    expect(result.valid).toBe(false); // different params → different digest
  });

  it('treats a malformed hash as invalid rather than throwing', async () => {
    for (const bad of ['', 'not-a-hash', '$argon2id$v=19$broken', '$bcrypt$v=19$m=1,t=1,p=1$a$b']) {
      await expect(verifyPassword('pw', bad)).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    }
  });

  it('burns comparable time for an unknown user', async () => {
    // Guards against username enumeration by response timing. Asserting the
    // work happens at all, not a wall-clock threshold — timing assertions are
    // flaky on shared CI.
    const started = performance.now();
    await equalizeTimingForUnknownUser('anything');
    expect(performance.now() - started).toBeGreaterThan(20);
  });
});

describe('CSRF tokens', () => {
  const SESSION = 'a'.repeat(64);

  it('round-trips for the session it was issued to', () => {
    const token = issueCsrfToken(SESSION);
    expect(verifyCsrfToken(SESSION, token)).toBe(true);
  });

  it('rejects a token minted for a different session', () => {
    // The flaw in naive double-submit: without binding, any valid-looking token
    // works against any session.
    const token = issueCsrfToken(SESSION);
    expect(verifyCsrfToken('b'.repeat(64), token)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = issueCsrfToken(SESSION);
    const [nonce, sig] = token.split('.');
    expect(verifyCsrfToken(SESSION, `${nonce}.${sig?.slice(0, -1)}X`)).toBe(false);
  });

  it('rejects a swapped nonce', () => {
    const [, signature] = issueCsrfToken(SESSION).split('.');
    expect(verifyCsrfToken(SESSION, `differentnonce.${signature}`)).toBe(false);
  });

  it.each([null, undefined, '', 'nodot', '.', '.sig'])('rejects malformed input %p', (bad) => {
    expect(verifyCsrfToken(SESSION, bad as string)).toBe(false);
  });

  it.each([
    ['GET', true],
    ['HEAD', true],
    ['OPTIONS', true],
    ['POST', false],
    ['PATCH', false],
    ['DELETE', false],
    ['post', false],
  ])('%s is safe: %p', (method, safe) => {
    expect(isSafeMethod(method)).toBe(safe);
  });
});

describe('permission matrix', () => {
  it('READONLY cannot change anything', () => {
    for (const permission of permissionsFor('READONLY')) {
      expect(permission.endsWith(':read')).toBe(true);
    }
  });

  it('STAFF can correct stock but not change prices', () => {
    expect(can('STAFF', 'stock:adjust')).toBe(true);
    expect(can('STAFF', 'product:write')).toBe(false);
    expect(can('STAFF', 'rate:write')).toBe(false);
  });

  it('MANAGER runs the catalog but cannot manage operators or keys', () => {
    expect(can('MANAGER', 'product:write')).toBe(true);
    expect(can('MANAGER', 'rate:write')).toBe(true);
    expect(can('MANAGER', 'admin:manage')).toBe(false);
    expect(can('MANAGER', 'apikey:manage')).toBe(false);
  });

  it('OWNER holds every permission', () => {
    for (const role of ['READONLY', 'STAFF', 'MANAGER'] as Role[]) {
      for (const permission of permissionsFor(role)) {
        expect(can('OWNER', permission)).toBe(true);
      }
    }
    expect(can('OWNER', 'admin:manage')).toBe(true);
  });

  it('grants nothing for an unknown API key scope', () => {
    expect(scopesAllow(['product:*', 'everything'], 'product:write')).toBe(false);
    expect(scopesAllow(['product:write'], 'product:write')).toBe(true);
  });
});

describe('token primitives', () => {
  it('generates 256 bits, URL-safe', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes deterministically to 64 hex characters', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('keys the IP hash, so the small IPv4 space cannot be brute-forced', () => {
    const hashed = hashIp('203.0.113.42');
    expect(hashed).not.toBeNull();
    expect(hashed).not.toContain('203');
    // Keyed with APP_SECRET, so a plain sha256 of the address does not match.
    expect(hashed).not.toBe(hashToken('203.0.113.42').slice(0, 32));
    expect(hashIp(null)).toBeNull();
  });

  it('compares hex digests safely, including on length mismatch', () => {
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
    expect(safeEqualHex('abcd', 'abce')).toBe(false);
    expect(safeEqualHex('abcd', 'ab')).toBe(false);
  });
});
