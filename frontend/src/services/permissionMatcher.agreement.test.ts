import { describe, expect, it } from 'vitest';
import { hasGrantedPermission, isWildcardGrant as frontendIsWildcardGrant } from './permissionMatcher';
import { isPermissionGranted, isWildcardGrant as backendIsWildcardGrant } from '../../../backend/src/auth/permission-matching';

/**
 * Gate 5.1 — the wildcard logic existed six times.
 *
 * `842445f` made `permissionMatcher` the frontend's single authority for
 * permissions, and that was true: no screen rolled its own grant check. It was not
 * true of the *matching*, which was written independently in `RbacGuard`,
 * `app-bootstrap.service`, the unloading-rule controller, `permission-catalog`,
 * `permissionMatcher` and `iamService`. `sec-002` ties the id sets together and
 * says nothing about how a grant is matched, so a divergence between any two of
 * the six would not fail a test — it would change who can reach what.
 *
 * These two modules are in separate packages and cannot import each other, so the
 * tie has to be a shared table. Running both implementations over it is the only
 * way to know they agree rather than assuming it.
 */

const CASES: Array<[granted: string, required: string, expected: boolean]> = [
  ['*', 'anything.at.all', true],
  ['*', '', true],

  ['users.view', 'users.view', true],
  ['users.view', 'users.update', false],
  ['users.view', 'users', false],

  // The prefix rule, including the near-miss that a sloppy slice() would accept.
  ['users.*', 'users.view', true],
  ['users.*', 'users', true],
  ['users.*', 'usersomething.view', false],
  ['users.*', 'items.view', false],

  ['items.*', 'items.create.inbound', true],
  ['reports.*', 'reports.view', true],
  ['settings.*', 'settings.view.general', true],

  // A legacy id is not covered by a module wildcard unless the module matches.
  ['settings.view', 'settings.view.general', false],

  // Malformed grants must not match anything.
  ['*.*', 'users.view', false],
  ['', 'users.view', false],
  ['users..*', 'users.view', false],
  ['users*', 'users.view', false],
];

describe('the frontend and backend permission matchers agree', () => {
  it.each(CASES)('frontend: %s covers %s -> %s', (granted, required, expected) => {
    expect(hasGrantedPermission([granted], required)).toBe(expected);
  });

  it.each(CASES)('backend: %s covers %s -> %s', (granted, required, expected) => {
    expect(isPermissionGranted([granted], [required])).toBe(expected);
  });

  it('both sides classify a grant as a wildcard identically', () => {
    for (const grant of ['users.*', 'items.*', 'users.view', '*', '', 'users..*', '.*', '*.*']) {
      expect(
        frontendIsWildcardGrant(grant),
        `frontend disagreed about ${JSON.stringify(grant)}`,
      ).toBe(backendIsWildcardGrant(grant));
    }
  });

  it('a module allow-list is honoured the same way on both sides', () => {
    const known = new Set(['users', 'items']);
    for (const grant of ['users.*', 'reports.*', 'users.view', '*']) {
      expect(frontendIsWildcardGrant(grant, known)).toBe(backendIsWildcardGrant(grant, known));
    }
    // And the list genuinely narrows it.
    expect(backendIsWildcardGrant('reports.*', known)).toBe(false);
  });
});

describe('an empty requirement list is not a match', () => {
  // The guard in `RbacGuard` refused a route with no metadata before reaching the
  // matcher, and the old local copy returned true for an empty list — so the rule
  // now holds where the matching happens, not only at the caller.
  it('backend denies, and every required key must be satisfied', () => {
    expect(isPermissionGranted(['users.view'], [])).toBe(false);
    expect(isPermissionGranted(['users.view'], ['users.view', 'items.view'])).toBe(false);
    expect(isPermissionGranted(['users.*', 'items.*'], ['users.view', 'items.view'])).toBe(true);
  });
});
