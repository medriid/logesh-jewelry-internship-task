import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'drizzle/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Security-relevant hygiene, enforced rather than trusted to review.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-globals': ['error', { name: 'process', message: 'Import env from @/config/env instead of reading process.env directly.' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'crypto', message: "Use 'node:crypto' explicitly." },
            { name: 'jsonwebtoken', message: 'This project uses opaque server-side sessions, not JWTs. See docs/adr/0003.' },
          ],
        },
      ],
    },
  },
  {
    // env.ts and the instrumentation hook are the only places allowed to touch process.env.
    files: ['src/config/env.ts', 'instrumentation.ts', 'drizzle.config.ts', 'scripts/**', 'tests/**', 'vitest.config.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-console': 'off' },
  },
];
