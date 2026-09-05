import { isProduction } from '@/config/env';

/**
 * RFC 9457 Problem Details.
 *
 * Every error this API returns is `application/problem+json` with a stable
 * machine-readable `type`. Clients switch on `type`; humans read `title` and
 * `detail`. A bare `{ "error": "something went wrong" }` forces callers to
 * string-match, and string-matching breaks the moment copy is edited.
 *
 * https://www.rfc-editor.org/rfc/rfc9457
 */

export const PROBLEM_BASE = 'https://loupe.jewelry/problems';

export type ProblemType =
  | 'validation-failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'precondition-failed'
  | 'precondition-required'
  | 'idempotency-key-reused'
  | 'out-of-stock'
  | 'price-unavailable'
  | 'rate-limited'
  | 'payload-too-large'
  | 'unsupported-media-type'
  | 'internal-error'
  | 'service-unavailable';

/** One field-level failure, for a validation problem. */
export type FieldError = { field: string; message: string; code?: string };

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Ties the response to the structured logs and the audit row. */
  requestId?: string;
  errors?: FieldError[];
  /** Set on 429 and 503 alongside the Retry-After header. */
  retryAfterSeconds?: number;
};

const TITLES: Record<ProblemType, { title: string; status: number }> = {
  'validation-failed': { title: 'Validation failed', status: 422 },
  unauthenticated: { title: 'Authentication required', status: 401 },
  forbidden: { title: 'Insufficient permissions', status: 403 },
  'not-found': { title: 'Resource not found', status: 404 },
  conflict: { title: 'Conflict', status: 409 },
  'precondition-failed': { title: 'Precondition failed', status: 412 },
  'precondition-required': { title: 'Precondition required', status: 428 },
  'idempotency-key-reused': { title: 'Idempotency key reused', status: 422 },
  'out-of-stock': { title: 'Out of stock', status: 409 },
  'price-unavailable': { title: 'Price unavailable', status: 503 },
  'rate-limited': { title: 'Too many requests', status: 429 },
  'payload-too-large': { title: 'Payload too large', status: 413 },
  'unsupported-media-type': { title: 'Unsupported media type', status: 415 },
  'internal-error': { title: 'Internal server error', status: 500 },
  'service-unavailable': { title: 'Service unavailable', status: 503 },
};

export function problem(
  type: ProblemType,
  options: {
    detail?: string;
    instance?: string;
    requestId?: string;
    errors?: FieldError[];
    retryAfterSeconds?: number;
  } = {},
): Problem {
  const { title, status } = TITLES[type];
  return {
    type: `${PROBLEM_BASE}/${type}`,
    title,
    status,
    ...(options.detail !== undefined && { detail: options.detail }),
    ...(options.instance !== undefined && { instance: options.instance }),
    ...(options.requestId !== undefined && { requestId: options.requestId }),
    ...(options.errors !== undefined && { errors: options.errors }),
    ...(options.retryAfterSeconds !== undefined && {
      retryAfterSeconds: options.retryAfterSeconds,
    }),
  };
}

export function problemResponse(p: Problem, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/problem+json; charset=utf-8');
  // An error is never a cacheable representation of a resource.
  h.set('Cache-Control', 'no-store');
  if (p.retryAfterSeconds !== undefined) h.set('Retry-After', String(p.retryAfterSeconds));
  return new Response(JSON.stringify(p), { status: p.status, headers: h });
}

/**
 * The catch-all. Deliberately says nothing: in production the caller gets a
 * request id and nothing else, because a stack trace or a driver message is
 * reconnaissance. The detail goes to the logs, keyed by the same id.
 */
export function internalErrorResponse(requestId: string, cause: unknown): Response {
  return problemResponse(
    problem('internal-error', {
      requestId,
      detail: isProduction
        ? `An unexpected error occurred. Quote request id ${requestId} to support.`
        : cause instanceof Error
          ? cause.message
          : String(cause),
    }),
  );
}
