/**
 * FC-SEC-005 — the one frontend permission matcher.
 *
 * This replaces `permissionAliases.ts`, which carried a 36-entry map of legacy
 * ids (`settings.view.users`, `inventory.create.inbound`, …) onto canonical
 * catalog ids. None of those legacy ids exist in the backend catalog, and the
 * backend refuses unknown ids when a role is written, so an administrator could
 * never grant one — the UI only worked because the map translated at match time.
 *
 * That map made the defect invisible rather than absent. Every settings screen
 * and the operations import/export controls were one deletion away from silently
 * becoming SuperAdmin-only, with no test failing. Legacy id migration now lives
 * only where it belongs, in `backend/src/auth/permission-catalog.ts`, which runs
 * on the stored role row and therefore on the one authority that matters.
 *
 * The semantics below are deliberately identical to `RbacGuard.hasPermission` /
 * `matchWildcard` in the backend, so a control the UI enables is a control the
 * API allows.
 */

/** The wildcard literal granting every permission. */
export const FULL_ACCESS_TOKEN = '*';

const normalize = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    : [];

/**
 * `granted` is a `module.*` wildcard and `required` sits under it.
 * Mirrors RbacGuard.matchWildcard exactly.
 */
const matchWildcard = (granted: string, required: string): boolean => {
  if (!granted.endsWith('.*')) return false;
  const prefix = granted.slice(0, -2);
  return required === prefix || required.startsWith(`${prefix}.`);
};

/**
 * True when a single `required` permission is covered by the `granted` list.
 * A required id that is not a catalog id simply never matches, which is the
 * fail-closed behaviour the section needs.
 */
export const isPermissionGranted = (granted: readonly string[], required: string): boolean => {
  const target = String(required || '').trim();
  if (!target) return false;
  const list = normalize(granted);
  if (list.includes(FULL_ACCESS_TOKEN)) return true;
  if (list.includes(target)) return true;
  return list.some((entry) => matchWildcard(entry, target));
};

/**
 * True when every required permission is covered. Mirrors RbacGuard.hasPermission.
 */
export const hasGrantedPermission = (granted: readonly string[], ...required: string[]): boolean => {
  const list = normalize(granted);
  if (list.includes(FULL_ACCESS_TOKEN)) return true;
  return required.every((permission) => isPermissionGranted(list, permission));
};

/**
 * Kept for callers that used to expand a legacy id into its canonical form.
 * With legacy ids gone this is the identity, but the name survives so the
 * call sites in `iamService` read honestly instead of pretending to migrate.
 */
export const expandRequestedPermissions = (permission: string): string[] => {
  const normalized = String(permission || '').trim();
  return normalized ? [normalized] : [];
};
