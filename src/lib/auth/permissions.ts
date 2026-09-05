import type { adminRoleEnum } from '@/db/schema';

/**
 * The permission matrix.
 *
 * Permissions are derived from a role, never stored per user. One table, one
 * answer to "what can a MANAGER do", testable without a database, and
 * impossible to drift out of sync with itself the way per-user grants do.
 *
 * Roles are cumulative in practice but written out in full rather than as
 * "inherits from the role below". Explicit beats clever here: reading down a
 * column tells you exactly what a role can do, and adding a permission forces
 * a deliberate decision for every role instead of silently granting it to
 * everyone above some line.
 */

export type Role = (typeof adminRoleEnum.enumValues)[number];

export const PERMISSIONS = [
  'product:read', // includes DRAFT and ARCHIVED, which the public cannot see
  'product:write',
  'product:delete',
  'product:publish',
  'stock:read',
  'stock:adjust',
  'rate:read',
  'rate:write', // publishing a metal rate reprices the entire gold catalog
  'category:write',
  'attribute:write', // defining custom fields changes the shape of the catalog
  'media:upload',
  'audit:read',
  'admin:manage', // create and suspend operators
  'apikey:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  /** Auditors, accountants, a seasonal hire who must not change anything. */
  READONLY: ['product:read', 'stock:read', 'rate:read'],

  /** Shop floor. Can correct stock after a count; cannot change what things cost. */
  STAFF: ['product:read', 'stock:read', 'stock:adjust', 'rate:read', 'media:upload'],

  /** Runs the catalog day to day. Everything except operators and keys. */
  MANAGER: [
    'product:read',
    'product:write',
    'product:delete',
    'product:publish',
    'stock:read',
    'stock:adjust',
    'rate:read',
    'rate:write',
    'category:write',
    'attribute:write',
    'media:upload',
    'audit:read',
  ],

  /** Adds control over who else has access. */
  OWNER: [...PERMISSIONS],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}

/**
 * API keys carry an explicit scope list rather than a role, so a key is never
 * broader than the single job it was minted for. An unknown scope is not an
 * error — it is simply not a permission, so it grants nothing.
 */
export function scopesAllow(scopes: readonly string[], permission: Permission): boolean {
  return scopes.includes(permission);
}
