/**
 * Runs once when the server starts, before it serves a request.
 *
 * This is where deployment readiness is asserted. It cannot live in the env
 * schema, because `next build` forces NODE_ENV=production and a build has no
 * business requiring production secrets — see assertDeploymentReady().
 *
 * The effect on Vercel: a deploy missing its database or Redis credentials dies
 * at startup with a readable message in the function logs, rather than booting
 * happily and 500-ing on the first real request.
 */
export async function register() {
  // Only the Node.js runtime; the edge runtime has no server boot in this sense.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertDeploymentReady, env } = await import('@/config/env');
  assertDeploymentReady();

  if (env.NODE_ENV !== 'test') {
    console.warn(
      `[loupe] ready · env=${env.NODE_ENV} · db=${env.DATABASE_DRIVER} · ${env.APP_URL}`,
    );
  }
}
