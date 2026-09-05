import { z } from 'zod';

/**
 * Environment contract.
 *
 * Parsed once, at module load. A missing or malformed secret crashes the process
 * on boot with a readable list of what is wrong — it never surfaces later as a
 * 500 in a request handler, and it never silently degrades to an insecure default.
 *
 * `process.env` is banned by ESLint everywhere except this file, so this schema is
 * the complete, auditable inventory of the deployment's inputs.
 */

const nonEmpty = (label: string) =>
  z
    .string({ error: `${label} is required and must not be empty` })
    .trim()
    .min(1, `${label} must not be empty`);

/** Secrets used as HMAC/encryption keys must carry real entropy, not "changeme". */
const secretKey = (label: string) =>
  nonEmpty(label)
    .min(32, `${label} must be at least 32 characters (use: openssl rand -base64 48)`)
    .refine((v) => !/^(changeme|secret|password|test)/i.test(v), {
      message: `${label} looks like a placeholder`,
    });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /** Public origin, used for absolute URLs, cookie scoping, and the CORS allowlist. */
    APP_URL: z.url().default('http://localhost:3000'),

    /**
     * `pglite` boots an in-process Postgres (WASM) — zero setup, so a reviewer can
     * clone and run with no Docker and no cloud account. `postgres` targets a real
     * server (Neon in production). Same dialect either way.
     */
    DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
    DATABASE_URL: z.string().optional(),
    /** Where PGlite persists to on disk. `memory://` for ephemeral test runs. */
    PGLITE_PATH: z.string().default('./.pglite'),

    /** HMAC key for CSRF tokens and for hashing IPs before they are logged. */
    APP_SECRET: secretKey('APP_SECRET'),

    /** Argon2id cost. Defaults follow OWASP's 2024 minimum (19 MiB, t=2, p=1). */
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(19456),
    ARGON2_ITERATIONS: z.coerce.number().int().min(2).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(8).default(1),

    /** Idle and absolute session lifetimes, in seconds. */
    SESSION_IDLE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 12),
    SESSION_ABSOLUTE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 7),

    /**
     * Rate limiting. Without Upstash credentials the app falls back to an in-process
     * limiter — correct for a single dev machine, useless across serverless instances.
     * Production refuses to boot without them (see the superRefine below).
     */
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    /** Extra origins permitted to call the API with credentials. Comma-separated. */
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    /** Direct-to-storage image uploads. Optional; uploads 503 without them. */
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Seed credentials. Read only by `npm run db:seed`, never by the running app. */
    SEED_ADMIN_EMAIL: z.email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((env, ctx) => {
    // Shape-level coherence, true in every environment including a build.
    if (env.DATABASE_DRIVER === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DATABASE_DRIVER=postgres',
      });
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * Invariants that must hold for a *running production server*, checked
 * separately from parsing.
 *
 * The split exists because `next build` forces NODE_ENV=production, so folding
 * these into the schema meant a build could not succeed without production
 * secrets — breaking CI, and breaking `npm run build` on a laptop. Relaxing
 * them entirely would be worse: a misconfigured deploy would boot and fail on
 * the first request.
 *
 * So: the build validates shape, and the server asserts deployment readiness at
 * boot via instrumentation.ts. A Vercel deploy missing its Redis credentials
 * dies on startup with a readable message, before it serves anything.
 */
export function assertDeploymentReady(config: Env = env): void {
  if (config.NODE_ENV !== 'production') return;

  const failures: string[] = [];

  if (config.DATABASE_DRIVER !== 'postgres') {
    failures.push(
      'DATABASE_DRIVER must be "postgres" in production. PGlite writes to the local ' +
        'filesystem, which on serverless is ephemeral and not shared between instances — ' +
        'every write would be lost and every instance would see different data.',
    );
  }
  if (!config.APP_URL.startsWith('https://')) {
    failures.push('APP_URL must be https in production — session cookies are Secure-only.');
  }
  if (!config.UPSTASH_REDIS_REST_URL || !config.UPSTASH_REDIS_REST_TOKEN) {
    failures.push(
      'UPSTASH_REDIS_REST_URL and _TOKEN are required in production. The in-memory rate ' +
        'limiter is per-instance, so across serverless scale-out login would be effectively ' +
        'unthrottled.',
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Refusing to start: production configuration is unsafe.\n\n` +
        failures.map((f) => `  • ${f}`).join('\n\n') +
        `\n\nSee docs/DEPLOYMENT.md.\n`,
    );
  }
}

/** Treat empty dashboard entries as unset, without changing nonempty secrets. */
export function parseEnv(values: Record<string, string | undefined>): Env {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value !== undefined && value.trim() === '' ? undefined : value,
    ]),
  );
  const parsed = schema.safeParse(normalized);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    // Deliberately a hard crash: a half-configured server is worse than no server.
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\n`);
  }

  return parsed.data;
}

export const env: Env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
