// Gate 3.6 — eight of the fifteen route guards were keyed to permission ids the
// catalog does not contain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const app = readFileSync(join(repoRoot, 'frontend/src/App.tsx'), 'utf8');
const layout = readFileSync(join(repoRoot, 'frontend/src/components/Layout.tsx'), 'utf8');
const mirror = readFileSync(join(repoRoot, 'frontend/src/services/permissionsCatalog.ts'), 'utf8');
const matcher = readFileSync(join(repoRoot, 'frontend/src/services/permissionMatcher.ts'), 'utf8');

/**
 * Ids the catalog declares, from the frontend mirror the contract test ties to the
 * backend.
 *
 * `_` in the character class is not decoration. The class was `[a-zA-Z0-9.*\-]`, so
 * `admin.reset_system` matched nothing at all and the id was silently absent from
 * this set. A route gate naming it therefore passed the check below — which is the
 * one assertion in this file that exists to stop a gate from refusing everyone —
 * because the id it had to reject was invisible to the regex. The first route to use
 * an underscore id found it.
 */
const catalogIds = new Set(
  [...mirror.matchAll(/id:\s*'([a-zA-Z0-9.*_-]+)'/g)].map((m) => m[1]),
);

/** Source with comments removed, so a guard cannot be satisfied or tripped by prose. */
const codeOf = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

const appCode = codeOf(app);

test('gate 3.6 the catalog the guard compares against is not empty', () => {
  // A regex that matches nothing would make every assertion below pass.
  assert.ok(catalogIds.size >= 50, `expected the full catalog, matched ${catalogIds.size}`);
  assert.match(matcher, /hasGrantedPermission|isPermissionGranted/);
});

test('gate 3.6 every route gate names a permission that exists', () => {
  const gates = [...appCode.matchAll(/renderProtectedRoute\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(gates.length >= 10, `expected the route table, found ${gates.length} gates`);

  const unknown = [...new Set(gates)].filter((id) => !catalogIds.has(id));
  assert.deepEqual(
    unknown,
    [],
    'a gate on an id the catalog does not define refuses everyone, including the people who hold the real permission',
  );
});

test('gate 3.6 the route gate and the nav link name the same permission', () => {
  // The disagreement is what made this invisible: the link used the canonical id
  // so the page rendered, the route used a legacy one so the click was refused.
  // Nothing in the UI showed both, so the feature looked broken rather than gated.
  const nav = layout.slice(layout.indexOf('SECTION_PERMISSIONS'));
  const navBlock = nav.slice(0, nav.indexOf('}'));

  const pairs = [
    ['settings', /settings:\s*'([^']+)'/],
    ['users', /users:\s*'([^']+)'/],
    ['items', /items:\s*'([^']+)'/],
    ['operations', /operations:\s*'([^']+)'/],
    ['balances', /balances:\s*'([^']+)'/],
    ['opening-balance', /'opening-balance':\s*'([^']+)'/],
    ['reports', /reports:\s*'([^']+)'/],
  ];

  for (const [section, pattern] of pairs) {
    const match = navBlock.match(pattern);
    assert.ok(match, `SECTION_PERMISSIONS has no entry for ${section}`);
    const navId = match[1];
    assert.ok(
      catalogIds.has(navId),
      `the nav link for ${section} uses "${navId}", which the catalog does not define`,
    );
  }

  // And the two ids that were wrong on both sides must be the canonical ones now.
  assert.match(navBlock, /settings:\s*'settings\.view\.general'/);
  assert.match(navBlock, /users:\s*'users\.view'/);
});

test('gate 3.6 the matcher stays fail-closed, without an alias table', () => {
  // The fix was to correct the call sites, not to teach the matcher about legacy
  // ids. A matcher with an alias table would make every one of the eight wrong
  // gates look correct while leaving the catalog and the UI disagreeing.
  //
  // Compared without comments: the file's own header documents the alias map it
  // replaced, and quotes the name.
  const matcherCode = codeOf(matcher);
  assert.doesNotMatch(
    matcherCode,
    /LEGACY_PERMISSION_ALIASES|legacyAliases|permissionAliases/,
    'the aliases were removed for a reason; the call sites are what had to change',
  );
  assert.match(matcher, /replaces `permissionAliases\.ts`/);
});
