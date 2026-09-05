import 'server-only';

import type { ZodType } from 'zod';

import { validateApiKey, type ApiKeyIdentity } from '@/lib/auth/api-key';
import { CSRF_HEADER, isSafeMethod, verifyCsrfToken } from '@/lib/auth/csrf';
import { can, scopesAllow, type Permission } from '@/lib/auth/permissions';
import { SESSION_COOKIE, validateSession, type ActiveSession } from '@/lib/auth/session';
import { limiterFor, type LimitClass } from '@/lib/ratelimit';
import { buildContext, type RequestContext } from './context';
import { corsHeaders, isAllowedOrigin, preflightHeaders } from './cors';
import { internalErrorResponse, problem, problemResponse, type FieldError } from './problem';

/**
 * The request pipeline, assembled once so no route can omit a step.
 *
 * Order matters and is fixed: headers, correlation id, CORS, rate limit,
 * authenticate, authorise, CSRF, validate, then the handler. Every route in
 * `src/app/api` goes through `defineRoute`; none of them re-implement any of it.
 *
 * `auth` has no default. It is a required field, so a new route physically
 * cannot be written without stating who may call it — the alternative, a
 * default, means the day someone forgets is the day an endpoint is public.
 */

export type Actor =
  | { kind: 'ADMIN'; session: ActiveSession }
  | { kind: 'API_KEY'; key: ApiKeyIdentity }
  | { kind: 'ANONYMOUS' };

/** `'public'` is deliberately verbose: opening an endpoint should be a choice. */
export type AuthRequirement = 'public' | 'session' | { permission: Permission };

export type HandlerArgs<TBody, TQuery, TParams> = {
  request: Request;
  ctx: RequestContext;
  actor: Actor;
  body: TBody;
  query: TQuery;
  params: TParams;
};

export type RouteConfig<TBody, TQuery> = {
  auth: AuthRequirement;
  limit?: LimitClass;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  /** Parsed before the body is read, so an oversized payload never buffers. */
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

type NextRouteArgs<TParams> = { params: Promise<TParams> };

export function defineRoute<TBody = undefined, TQuery = undefined, TParams = object>(
  config: RouteConfig<TBody, TQuery>,
  handler: (args: HandlerArgs<TBody, TQuery, TParams>) => Promise<Response>,
) {
  return async function route(request: Request, next?: NextRouteArgs<TParams>): Promise<Response> {
    const ctx = buildContext(request);

    try {
      if (ctx.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: preflightHeaders(ctx.origin) });
      }

      // A cross-origin write from an origin we do not trust is rejected before
      // anything is parsed or any credential is looked up.
      if (!isSafeMethod(ctx.method) && !isAllowedOrigin(ctx.origin)) {
        return finish(
          problemResponse(
            problem('forbidden', { requestId: ctx.requestId, detail: 'Origin not allowed.' }),
          ),
          ctx,
        );
      }

      const limited = await enforceRateLimit(config, ctx);
      if (limited) return finish(limited, ctx);

      const actor = await authenticate(request);

      const denied = authorise(config.auth, actor, ctx);
      if (denied) return finish(denied, ctx);

      // CSRF applies only to cookie-authenticated writes. An API key is not an
      // ambient credential — a hostile page cannot make the browser attach one.
      if (!isSafeMethod(ctx.method) && actor.kind === 'ADMIN') {
        const token = request.headers.get(CSRF_HEADER);
        if (!verifyCsrfToken(actor.session.id, token)) {
          return finish(
            problemResponse(
              problem('forbidden', {
                requestId: ctx.requestId,
                detail: 'Missing or invalid CSRF token.',
              }),
            ),
            ctx,
          );
        }
      }

      const parsedQuery = parseQuery(config, request, ctx);
      if ('response' in parsedQuery) return finish(parsedQuery.response, ctx);

      const parsedBody = await parseBody(config, request, ctx);
      if ('response' in parsedBody) return finish(parsedBody.response, ctx);

      const params = next ? await next.params : ({} as TParams);

      const response = await handler({
        request,
        ctx,
        actor,
        body: parsedBody.value,
        query: parsedQuery.value,
        params,
      });

      return finish(response, ctx);
    } catch (error: unknown) {
      // The only place an unexpected throw is turned into a response. The
      // detail goes to the logs; the caller gets a request id.
      console.error(
        JSON.stringify({
          level: 'error',
          requestId: ctx.requestId,
          method: ctx.method,
          path: ctx.path,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
      return finish(internalErrorResponse(ctx.requestId, error), ctx);
    }
  };
}

// ── Steps ───────────────────────────────────────────────────────────────────

async function enforceRateLimit(
  config: RouteConfig<unknown, unknown>,
  ctx: RequestContext,
): Promise<Response | null> {
  const limitClass: LimitClass = config.limit ?? (isSafeMethod(ctx.method) ? 'read' : 'write');
  const result = await limiterFor(limitClass).check(`${limitClass}:${ctx.ip ?? 'unknown'}`);
  if (result.success) return null;

  return problemResponse(
    problem('rate-limited', {
      requestId: ctx.requestId,
      detail: `Rate limit exceeded. Retry in ${result.retryAfterSeconds}s.`,
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    { 'X-RateLimit-Limit': String(result.limit), 'X-RateLimit-Remaining': '0' },
  );
}

async function authenticate(request: Request): Promise<Actor> {
  // A bearer key wins if present, so a browser session cannot be accidentally
  // combined with a key to widen scope.
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const key = await validateApiKey(authorization.slice(7).trim());
    return key ? { kind: 'API_KEY', key } : { kind: 'ANONYMOUS' };
  }

  const cookie = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const session = await validateSession(cookie);
  return session ? { kind: 'ADMIN', session } : { kind: 'ANONYMOUS' };
}

function authorise(
  requirement: AuthRequirement,
  actor: Actor,
  ctx: RequestContext,
): Response | null {
  if (requirement === 'public') return null;

  if (actor.kind === 'ANONYMOUS') {
    return problemResponse(
      problem('unauthenticated', { requestId: ctx.requestId, instance: ctx.path }),
    );
  }

  if (requirement === 'session') {
    return actor.kind === 'ADMIN'
      ? null
      : problemResponse(
          problem('forbidden', {
            requestId: ctx.requestId,
            detail: 'This endpoint requires an interactive session.',
          }),
        );
  }

  const permitted =
    actor.kind === 'ADMIN'
      ? can(actor.session.user.role, requirement.permission)
      : scopesAllow(actor.key.scopes, requirement.permission);

  return permitted
    ? null
    : problemResponse(
        problem('forbidden', {
          requestId: ctx.requestId,
          detail: `Requires the "${requirement.permission}" permission.`,
        }),
      );
}

type Parsed<T> = { value: T } | { response: Response };

function parseQuery<TBody, TQuery>(
  config: RouteConfig<TBody, TQuery>,
  request: Request,
  ctx: RequestContext,
): Parsed<TQuery> {
  if (!config.query) return { value: undefined as TQuery };

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = config.query.safeParse(params);
  if (result.success) return { value: result.data };

  return { response: validationProblem(result.error.issues, ctx, 'query') };
}

async function parseBody<TBody, TQuery>(
  config: RouteConfig<TBody, TQuery>,
  request: Request,
  ctx: RequestContext,
): Promise<Parsed<TBody>> {
  if (!config.body) return { value: undefined as TBody };

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      response: problemResponse(
        problem('unsupported-media-type', {
          requestId: ctx.requestId,
          detail: 'Expected application/json.',
        }),
      ),
    };
  }

  // Checked before reading, so an oversized body is refused rather than buffered.
  const declared = Number(request.headers.get('content-length') ?? '0');
  const max = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (declared > max) {
    return {
      response: problemResponse(
        problem('payload-too-large', {
          requestId: ctx.requestId,
          detail: `Body exceeds ${max} bytes.`,
        }),
      ),
    };
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      response: validationProblem([{ path: [], message: 'Body is not valid JSON' }], ctx, 'body'),
    };
  }

  const result = config.body.safeParse(raw);
  if (result.success) return { value: result.data };

  return { response: validationProblem(result.error.issues, ctx, 'body') };
}

function validationProblem(
  issues: readonly { path: readonly PropertyKey[]; message: string; code?: string }[],
  ctx: RequestContext,
  source: 'body' | 'query',
): Response {
  const errors: FieldError[] = issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : source,
    message: issue.message,
    ...(issue.code !== undefined && { code: issue.code }),
  }));

  return problemResponse(
    problem('validation-failed', { requestId: ctx.requestId, instance: ctx.path, errors }),
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function finish(response: Response, ctx: RequestContext): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', ctx.requestId);
  for (const [key, value] of Object.entries(corsHeaders(ctx.origin))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
