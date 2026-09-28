// Gate 5.1 — the permission matcher was written six times.
//
// The first single-authority change (842445f) removed the second gate from
// @Permissions and made `permissionMatcher` the frontend's answer. It did not make
// the matcher itself the answer: the wildcard logic existed independently in
// RbacGuard, app-bootstrap, the unloading-rule controller, the permission
// catalogue, permissionMatcher and iamService. `sec-002` asserts the id *sets*
// match and nothing about the matching, so a divergence between two of the six
// would not fail a test — it would change who can do what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

test('gate 5.1 there is one matcher on each side, and the rest call it', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  };
  walk(join(repoRoot, 'backend/src'));
  walk(join(repoRoot, 'frontend/src'));

  // The syntax is `granted.endsWith('.*')`. Two files may contain it: the
  // matcher itself and, on the frontend, the function that wraps it. Anything
  // else is a fourth authority waiting to drift.
  const authorities = {
    'backend/src/auth/permission-matching.ts': 0,
    'frontend/src/services/permissionMatcher.ts': 0,
  };
  // Prose in the authorities mentions the syntax in backticks; only a real
  // expression is counted, so a comment cannot make a file look like an authority
  // or disguise a stray as one.

  const strays = [];
  for (const file of files) {
    // Normalised: `readdirSync` + `join` produce backslashes on Windows, so the
    // authority keys below — written with forward slashes, as the repo paths are —
    // would never match and every file would look like a stray. That is exactly
    // what happened the first time this ran: the guard failed and named the two
    // authorities as the problem.
    const rel = file.split(/[\\/]/).join('/').replace(/^.*?(backend\/src|frontend\/src)/, '$1');
    if (rel in authorities) {
      authorities[rel] = readFileSync(file, 'utf8').split("endsWith('.*')").length - 1;
      continue;
    }
    const hits = readFileSync(file, 'utf8').split("endsWith('.*')").length - 1;
    if (hits > 0) strays.push(`${rel} (${hits})`);
  }

  assert.deepEqual(
    strays,
    [],
    'a second implementation of the wildcard syntax is how a permission change becomes a lockout nobody can reproduce',
  );
  assert.ok(
    authorities['backend/src/auth/permission-matching.ts'] > 0,
    'the backend authority must exist and contain the syntax',
  );
});

test('gate 5.1 every consumer imports the authority rather than restating it', () => {
  for (const rel of [
    'backend/src/auth/rbac.guard.ts',
    'backend/src/app-bootstrap/app-bootstrap.service.ts',
    'backend/src/unloading-rule/unloading-rule.controller.ts',
    'backend/src/auth/permission-catalog.ts',
  ]) {
    const source = readFileSync(join(repoRoot, rel), 'utf8');
    assert.match(
      source,
      /from '\.\.?\/.*permission-matching'/,
      `${rel} must import the matcher, not carry a copy of it`,
    );
  }

  const iam = readFileSync(join(repoRoot, 'frontend/src/services/iamService.ts'), 'utf8');
  assert.match(iam, /from '\.\/permissionMatcher'/);
});

test('gate 5.1 the two matchers are tied by a shared table, not by an assumption', () => {
  // The cross-runtime comparison lives in the vitest suite, which can import a
  // frontend module and a backend module in the same process. An earlier draft
  // shelled out to `npx tsx`, which is not installed here — so the test would have
  // failed for a reason that has nothing to do with permissions.
  const agreement = readFileSync(
    join(repoRoot, 'frontend/src/services/permissionMatcher.agreement.test.ts'),
    'utf8',
  );
  assert.match(agreement, /from '\.\.\/\.\.\/\.\.\/backend\/src\/auth\/permission-matching'/);
  // The cases that a sloppy slice() or a missing prefix guard would get wrong.
  for (const [granted, required] of [
    ["'users.*'", "'usersomething.view'"],
    ["'settings.view'", "'settings.view.general'"],
    ["'*.*'", "'users.view'"],
  ]) {
    assert.ok(
      agreement.includes(`${granted}, ${required}`),
      `the agreement table must cover ${granted} vs ${required}`,
    );
  }
});
