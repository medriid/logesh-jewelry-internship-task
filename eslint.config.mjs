import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config, using eslint-config-next's native flat exports directly, rather
 * than routing a flat config through the `FlatCompat` eslintrc shim.
 *
 * Pinned to ESLint 9 deliberately: eslint-config-next@16 bundles an
 * eslint-plugin-react that still calls `context.getFilename()`, which ESLint 10
 * removed, so `eslint .` crashes outright on 10. 9.x is in maintenance and still
 * receives fixes. Revisit when eslint-config-next ships an ESLint 10 build.
 *
 * The custom rules below are not style preferences. Each one closes a hole that
 * code review would otherwise have to catch every single time.
 */
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'drizzle/**',
      '.pglite/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // Structured logging only. A stray console.log in a request handler is how
      // a session token ends up in a log aggregator.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // The rule that keeps src/config/env.ts honest: if nothing else may read
      // process.env, then that Zod schema really is the complete, auditable
      // inventory of this deployment's inputs.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Import { env } from "@/config/env" — it is validated at boot.',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'jsonwebtoken',
              message:
                'This project uses opaque server-side sessions, not JWTs. See docs/adr/0003.',
            },
            {
              name: 'crypto',
              message: "Use 'node:crypto' so the runtime target is explicit.",
            },
          ],
        },
      ],
    },
  },

  {
    // The boundary layer: these files are *allowed* to touch raw process.env,
    // because reading and validating it is their entire job.
    files: [
      'src/config/env.ts',
      'instrumentation.ts',
      'drizzle.config.ts',
      'next.config.ts',
      'scripts/**',
      'tests/**',
      'vitest.config.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'no-restricted-properties': 'off',
      'no-console': 'off',
    },
  },

  {
    // Tool config files are consumed by name, not imported; a default export is
    // the required shape, so the "name your default export" rule doesn't apply.
    files: ['*.config.mjs', '*.config.ts'],
    rules: { 'import/no-anonymous-default-export': 'off' },
  },
];
