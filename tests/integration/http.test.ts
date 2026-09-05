import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { closeDb, db } from '../../src/db';
import { adminUsers, apiKeys, sessions } from '../../src/db/schema';
import { createSession, SESSION_COOKIE, validateSession } from '../../src/lib/auth/session';
import { createApiKey, validateApiKey } from '../../src/lib/auth/api-key';
import { hashToken } from '../../src/lib/auth/tokens';
import { issueCsrfToken } from '../../src/lib/auth/csrf';
import { defineRoute } from '../../src/lib/http/handler';
import { resetLimiters } from '../../src/lib/ratelimit';
import {
  GET as sessionGet,
  OPTIONS as sessionOptions,
} from '../../src/app/api/v1/auth/session/route';
import { POST as logout } from '../../src/app/api/v1/auth/logout/route';
import { OPTIONS as loginOptions } from '../../src/app/api/v1/auth/login/route';
import { OPTIONS as healthOptions } from '../../src/app/api/v1/health/route';
import { OPTIONS as logoutOptions } from '../../src/app/api/v1/auth/logout/route';
import { migrateAppDatabase } from '../helpers/database';

let userId: string;
beforeAll(async () => {
  await migrateAppDatabase();
  const [user] = await db
    .insert(adminUsers)
    .values({
      email: 'http@example.com',
      name: 'HTTP test',
      passwordHash: 'unused',
      status: 'ACTIVE',
      role: 'OWNER',
    })
    .returning({ id: adminUsers.id });
  userId = user!.id;
});
beforeEach(resetLimiters);
afterAll(closeDb);

const echo = defineRoute(
  { auth: 'public', body: z.object({ text: z.string() }), maxBodyBytes: 32 },
  async ({ body }) => Response.json(body),
);

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

describe('request parsing', () => {
  it.each([{}, { 'Content-Length': '1' }])(
    'rejects oversized actual bytes with headers %j',
    async (headers) => {
      const response = await echo(request(JSON.stringify({ text: 'x'.repeat(100) }), headers));
      expect(response.status).toBe(413);
    },
  );

  it('counts UTF-8 bytes, not characters', async () => {
    expect((await echo(request(JSON.stringify({ text: '💎'.repeat(8) })))).status).toBe(413);
  });

  it('stops reading and cancels an oversized stream', async () => {
    let cancelled = false;
    const bytes = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.encode('{"text":"'));
        controller.enqueue(bytes.encode('x'.repeat(50)));
        // Deliberately never close: rejection must not await the whole body.
      },
      cancel() {
        cancelled = true;
      },
    });
    const init: RequestInit & { duplex: string } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    };
    expect((await echo(new Request('http://localhost:3000/api/test', init))).status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it('accepts JSON at exactly the byte limit', async () => {
    const body = JSON.stringify({ text: 'x'.repeat(21) });
    expect(new TextEncoder().encode(body)).toHaveLength(32);
    expect((await echo(request(body))).status).toBe(200);
  });

  it('rejects malformed JSON as a validation error', async () => {
    expect((await echo(request('{'))).status).toBe(422);
  });

  it('checks the complete media type', async () => {
    expect((await echo(request('{}', { 'Content-Type': 'application/jsonp' }))).status).toBe(415);
    expect(
      (await echo(request('{"text":"ok"}', { 'Content-Type': 'Application/JSON; charset=utf-8' })))
        .status,
    ).toBe(200);
  });

  it('treats malformed cookie encoding as unauthenticated', async () => {
    const response = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { Cookie: `${SESSION_COOKIE}=%broken` },
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe('browser session lifecycle', () => {
  it('renews the browser cookie and returns the renewed database deadline', async () => {
    const { token } = await createSession(userId);
    const oldExpiry = new Date(Date.now() + 120_000);
    await db
      .update(sessions)
      .set({ expiresAt: oldExpiry })
      .where(eq(sessions.id, hashToken(token)));
    const response = await sessionGet(
      new Request('http://localhost:3000/api/v1/auth/session', {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const [stored] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, hashToken(token)));
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(oldExpiry.getTime());
    expect(body.data.expiresAt).toBe(stored!.expiresAt.toISOString());
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringContaining(`Expires=${stored!.expiresAt.toUTCString()}`),
    );
  });

  it('requires CSRF for logout and does not overwrite the deletion cookie', async () => {
    const { token } = await createSession(userId);
    const headers = { Cookie: `${SESSION_COOKIE}=${token}` };
    const url = 'http://localhost:3000/api/v1/auth/logout';
    expect((await logout(new Request(url, { method: 'POST', headers }))).status).toBe(403);
    const response = await logout(
      new Request(url, {
        method: 'POST',
        headers: {
          ...headers,
          'X-CSRF-Token': issueCsrfToken(hashToken(token)),
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.get('Set-Cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(await validateSession(token)).toBeNull();
  });
});

describe('CORS preflight', () => {
  it.each([loginOptions, sessionOptions, logoutOptions, healthOptions])(
    'handles preflight through the exported route',
    async (options) => {
      const response = await options(
        new Request('http://localhost:3000/api/test', {
          method: 'OPTIONS',
          headers: { Origin: 'http://localhost:3000' },
        }),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
      expect(response.headers.get('X-Request-Id')).toBeTruthy();
    },
  );

  it('does not grant untrusted origins access', async () => {
    const response = await loginOptions(
      new Request('http://localhost:3000/api/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://untrusted.example' },
      }),
    );
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});

describe('machine authentication', () => {
  it('persists the last-used timestamp when validating an API key', async () => {
    const issued = await createApiKey({ name: 'test client', scopes: [], createdBy: userId });
    expect(await validateApiKey(issued.key)).not.toBeNull();
    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.id, issued.id));
    expect(stored!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('accepts case-insensitive bearer authentication', async () => {
    const issued = await createApiKey({
      name: 'reader',
      scopes: ['product:read'],
      createdBy: userId,
    });
    const route = defineRoute({ auth: { permission: 'product:read' } }, async () =>
      Response.json({ ok: true }),
    );
    expect(
      (
        await route(
          new Request('http://localhost:3000/api/test', {
            headers: { Authorization: `bearer ${issued.key}` },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it.each(['Basic invalid', 'Bearer', 'Bearer invalid'])(
    'does not fall back to a cookie for %s',
    async (authorization) => {
      const { token } = await createSession(userId);
      expect(
        (
          await sessionGet(
            new Request('http://localhost:3000/api/v1/auth/session', {
              headers: { Authorization: authorization, Cookie: `${SESSION_COOKIE}=${token}` },
            }),
          )
        ).status,
      ).toBe(401);
    },
  );
});

describe('CORS cache variation', () => {
  it.each([null, 'http://localhost:3000', 'https://untrusted.example'])(
    'preserves cache variation for origin %s',
    async (origin) => {
      const route = defineRoute(
        { auth: 'public' },
        async () => new Response('ok', { headers: { Vary: 'Accept-Encoding' } }),
      );
      const response = await route(
        new Request('http://localhost:3000/api/test', {
          headers: origin ? { Origin: origin } : {},
        }),
      );
      expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    },
  );
});
