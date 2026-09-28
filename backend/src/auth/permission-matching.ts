/**
 * Gate 5.1 — the one implementation of "does this grant cover that permission".
 *
 * This logic was written five times on the backend and once on the frontend:
 * `RbacGuard.matchWildcard`, `app-bootstrap.service.hasPermission`,
 * `unloading-rule.controller`'s inline copy, a fourth in the audit surface, and
 * `permission-catalog.ts`'s own normaliser. They are all correct today and all
 * separately editable, which is the problem: a change to wildcard semantics —
 * recursive `**`, a module list that is not a prefix, an exception for a
 * deprecated key — would have to be applied in five places, and missing one does
 * not fail a test, it silently changes who can do what.
 *
 * The catalogue test ties the frontend mirror to the backend ids, but no test tied
 * the five matchers to each other. `sec-002` asserts the id sets are identical and
 * nothing more.
 *
 * So the authority is a function, and the others call it.
 */

/** True when `granted` is a wildcard that covers `required`. */
export const matchesWildcard = (granted: string, required: string): boolean => {
  if (typeof granted !== 'string' || typeof required !== 'string') return false;
  if (!granted.endsWith('.*')) return false;

  const prefix = granted.slice(0, -2);
  if (!prefix) return false;

  // `users.*` covers `users.view` and `users`, but not `usersomething.view`.
  return required === prefix || required.startsWith(`${prefix}.`);
};

/**
 * True when the granted list satisfies every required permission.
 *
 * Every required permission must be satisfied, not one of them: a route declaring
 * two keys means both. An empty requirement list is not a match — a caller that
 * passes nothing asked nothing, and treating that as "allowed" is how a route ends
 * up unprotected because someone forgot a decorator.
 */
export const isPermissionGranted = (
  granted: readonly string[] | null | undefined,
  required: readonly string[] | null | undefined,
): boolean => {
  const grants = Array.isArray(granted) ? granted.filter((entry): entry is string => typeof entry === 'string') : [];
  const requirements = Array.isArray(required)
    ? required.filter((entry): entry is string => typeof entry === 'string')
    : [];

  if (!requirements.length) return false;
  if (grants.includes('*')) return true;

  return requirements.every(
    (permission) => grants.includes(permission) || grants.some((grant) => matchesWildcard(grant, permission)),
  );
};

/** True when this single grant is one the system recognises as a wildcard. */
export const isWildcardGrant = (grant: string, knownModuleKeys?: ReadonlySet<string>): boolean => {
  if (!grant.endsWith('.*')) return false;
  const prefix = grant.slice(0, -2);
  if (!prefix) return false;
  if (knownModuleKeys && !knownModuleKeys.has(prefix)) return false;
  return true;
};
