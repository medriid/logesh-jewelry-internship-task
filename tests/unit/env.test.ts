import { describe, expect, it } from 'vitest';

import { assertDeploymentReady, parseEnv } from '../../src/config/env';

const secret = 'env-fixture-with-at-least-32-characters';

describe('environment configuration', () => {
  it('uses defaults for empty dashboard entries', () => {
    const config = parseEnv({
      APP_SECRET: secret,
      DATABASE_DRIVER: '',
      ARGON2_MEMORY_KIB: '',
      ARGON2_ITERATIONS: ' ',
      ARGON2_PARALLELISM: '',
      SESSION_IDLE_TTL_SECONDS: '',
      SESSION_ABSOLUTE_TTL_SECONDS: '',
      LOG_LEVEL: '',
      APP_URL: '',
      PGLITE_PATH: '',
      SEED_ADMIN_EMAIL: '',
      SEED_ADMIN_PASSWORD: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
    });
    expect(config).toMatchObject({
      DATABASE_DRIVER: 'pglite',
      ARGON2_MEMORY_KIB: 19456,
      ARGON2_ITERATIONS: 2,
      ARGON2_PARALLELISM: 1,
      SESSION_IDLE_TTL_SECONDS: 43200,
      SESSION_ABSOLUTE_TTL_SECONDS: 604800,
      LOG_LEVEL: 'info',
      APP_URL: 'http://localhost:3000',
      PGLITE_PATH: './.pglite',
    });
    expect(config.SEED_ADMIN_EMAIL).toBeUndefined();
    expect(config.SEED_ADMIN_PASSWORD).toBeUndefined();
    expect(config.UPSTASH_REDIS_REST_URL).toBeUndefined();
  });

  it.each([undefined, '', '   ', 'short'])(
    'still rejects a missing or weak APP_SECRET (%s)',
    (value) => {
      expect(() => parseEnv({ APP_SECRET: value })).toThrow(/APP_SECRET/);
    },
  );

  it('preserves nonempty credential values', () => {
    const config = parseEnv({ APP_SECRET: secret, SEED_ADMIN_PASSWORD: '  a real password  ' });
    expect(config.SEED_ADMIN_PASSWORD).toBe('  a real password  ');
  });

  it('does not treat invalid nonempty settings as defaults', () => {
    expect(() => parseEnv({ APP_SECRET: secret, ARGON2_ITERATIONS: '0' })).toThrow(
      /ARGON2_ITERATIONS/,
    );
    expect(() => parseEnv({ APP_SECRET: secret, DATABASE_DRIVER: 'mysql' })).toThrow(
      /DATABASE_DRIVER/,
    );
  });

  it('requires a connection URL when postgres is selected', () => {
    expect(() =>
      parseEnv({ APP_SECRET: secret, DATABASE_DRIVER: 'postgres', DATABASE_URL: '' }),
    ).toThrow(/DATABASE_URL is required/);
  });

  it('does not allow production to run on development defaults', () => {
    const config = parseEnv({ NODE_ENV: 'production', APP_SECRET: secret, DATABASE_DRIVER: '' });
    expect(() => assertDeploymentReady(config)).toThrow(/DATABASE_DRIVER must be "postgres"/);
  });

  it('accepts complete production configuration with optional settings blank', () => {
    const config = parseEnv({
      NODE_ENV: 'production',
      APP_SECRET: secret,
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgresql://user:password@localhost/example',
      APP_URL: 'https://example.com',
      UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
      UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
      SEED_ADMIN_EMAIL: '',
      SEED_ADMIN_PASSWORD: '',
    });
    expect(() => assertDeploymentReady(config)).not.toThrow();
  });
});
