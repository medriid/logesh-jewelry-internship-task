import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env, isProduction } from '@/config/env';

/**
 * Rate limiting.
 *
 * Two adapters behind one interface. Upstash Redis in production; an in-process
 * limiter locally so a fresh clone needs no accounts.
 *
 * The in-process one is genuinely not safe for production and the app refuses
 * to boot without Redis there (`assertDeploymentReady`). The reason is worth
 * being precise about: serverless runs many instances, each with its own
 * memory, so a "5 attempts per minute" budget becomes "5 per minute *per
 * instance*" — which under load is no limit at all, on the login endpoint,
 * which is the one that matters. That failure is invisible until someone is
 * brute-forcing you.
 */

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the caller may retry. Feeds the Retry-After header. */
  retryAfterSeconds: number;
};

export type Limiter = { check(identifier: string): Promise<RateLimitResult> };

/**
 * Budgets per route class. Login is far tighter than catalog reads because the
 * cost of a wrong guess is asymmetric: a scraped product listing is public
 * anyway, a guessed admin password is the whole shop.
 */
export const LIMITS = {
  login: { tokens: 5, window: '1 m' },
  auth: { tokens: 20, window: '1 m' },
  write: { tokens: 60, window: '1 m' },
  read: { tokens: 200, window: '1 m' },
} as const;

export type LimitClass = keyof typeof LIMITS;

// ── In-process (development) ────────────────────────────────────────────────

/**
 * Sliding window over an in-memory map. Entries are swept on write rather than
 * on a timer, so an idle process holds nothing and there is no interval to
 * leak in a hot-reloading dev server.
 */
function createMemoryLimiter(tokens: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>();

  return {
    async check(identifier: string): Promise<RateLimitResult> {
      const now = Date.now();
      const cutoff = now - windowMs;

      for (const [key, times] of hits) {
        const live = times.filter((t) => t > cutoff);
        if (live.length === 0) hits.delete(key);
        else hits.set(key, live);
      }

      const recent = hits.get(identifier) ?? [];
      if (recent.length >= tokens) {
        const oldest = recent[0] ?? now;
        return {
          success: false,
          limit: tokens,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }

      recent.push(now);
      hits.set(identifier, recent);
      return {
        success: true,
        limit: tokens,
        remaining: tokens - recent.length,
        retryAfterSeconds: 0,
      };
    },
  };
}

// ── Upstash (production) ────────────────────────────────────────────────────

function createRedisLimiter(tokens: number, window: string, prefix: string): Limiter {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL as string,
    token: env.UPSTASH_REDIS_REST_TOKEN as string,
  });

  const limiter = new Ratelimit({
    redis,
    // Sliding window, not fixed: a fixed window lets an attacker fire the full
    // budget at 0:59 and again at 1:00, doubling the effective rate at the seam.
    limiter: Ratelimit.slidingWindow(
      tokens,
      window as Parameters<typeof Ratelimit.slidingWindow>[1],
    ),
    prefix: `loupe:rl:${prefix}`,
    analytics: false,
  });

  return {
    async check(identifier: string): Promise<RateLimitResult> {
      const { success, limit, remaining, reset } = await limiter.limit(identifier);
      return {
        success,
        limit,
        remaining,
        retryAfterSeconds: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
      };
    },
  };
}

// ── Selection ───────────────────────────────────────────────────────────────

const WINDOW_MS: Record<LimitClass, number> = {
  login: 60_000,
  auth: 60_000,
  write: 60_000,
  read: 60_000,
};

const cache = new Map<LimitClass, Limiter>();

export function limiterFor(limitClass: LimitClass): Limiter {
  const existing = cache.get(limitClass);
  if (existing) return existing;

  const { tokens, window } = LIMITS[limitClass];
  const hasRedis = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

  const limiter =
    hasRedis && isProduction
      ? createRedisLimiter(tokens, window, limitClass)
      : createMemoryLimiter(tokens, WINDOW_MS[limitClass]);

  cache.set(limitClass, limiter);
  return limiter;
}

/** Test seam — the in-memory limiter keeps state across a test file otherwise. */
export function resetLimiters(): void {
  cache.clear();
}
