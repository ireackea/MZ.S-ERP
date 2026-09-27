// FC-SEC-013 — one authority for authorisation.
//
// Sixteen routes across seven modules were guarded by a permission *and* a role
// at the same time:
//
//   @Permissions('opening-balances.create')
//   @Roles('Admin', 'SuperAdmin')
//
// RbacGuard checks both, and passes only when both agree. So a grant an
// administrator could see and make in the IAM matrix had no effect: Manager
// holds `opening-balances.*` in role-templates.ts, the matrix shows it granted,
// and the API still answered 403 "Insufficient role". Nothing in the product
// told the administrator the grant was inert, and `RbacGuard.hasRole` also lets
// `superadmin` through unconditionally, so the gate behaved inconsistently on
// top of that.
//
// The catalog is the single permission source (see sec-002-contract), so the
// permission is the gate and the role is not. This guard fails if the second
// mechanism is reintroduced anywhere, so the silent override cannot come back
// unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const backendSrc = join(repoRoot, 'backend/src');

const controllers = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.controller.ts')) controllers.push(full);
  }
};
walk(backendSrc);

test('FC-SEC-013 no route declares a role gate alongside a permission', () => {
  const offenders = [];
  for (const file of controllers) {
    const source = readFileSync(file, 'utf8');
    if (/@Roles\(/.test(source)) {
      offenders.push(relative(repoRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these controllers reintroduce a second authorisation mechanism, which silently overrides grants:\n  ${offenders.join('\n  ')}`,
  );
});

test('FC-SEC-013 every mutating route is guarded by a permission', () => {
  // With the role gate gone, a permission is the only thing standing between a
  // request and a write, so a mutating route with no permission decorator is
  // now a real exposure rather than a style problem.
  const offenders = [];
  for (const file of controllers) {
    const source = readFileSync(file, 'utf8');
    const blocks = source.split(/@(Post|Put|Patch|Delete)\(/).slice(1);
    for (let i = 0; i < blocks.length; i += 2) {
      const body = blocks[i + 1] ?? '';
      // The decorators for a handler sit immediately above it, so look at the
      // text between the previous handler boundary and this verb.
      const before = source.slice(0, source.indexOf(`@${blocks[i]}(`));
      const tail = before.slice(-400);
      const publicHandler = /@Public\(\)/.test(tail);
      const authenticatedOnly = /@AllowAuthenticated\(\)/.test(tail);
      const hasPermission = /@Permissions\(/.test(tail);
      if (!publicHandler && !authenticatedOnly && !hasPermission) {
        offenders.push(`${relative(repoRoot, file)} @${blocks[i]}(${body.split('\n')[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `mutating routes with no permission guard:\n  ${offenders.join('\n  ')}`);
});

test('FC-SEC-013 the catalog no longer documents a gate that does not exist', () => {
  const catalog = readFileSync(join(backendSrc, 'auth/permission-catalog.ts'), 'utf8');
  const claims = [...catalog.matchAll(/مقصر على [^،)]*/g)].map((m) => m[0]);
  assert.deepEqual(
    claims,
    [],
    'a catalog description still claims an Admin/SuperAdmin restriction that no longer exists',
  );
});
