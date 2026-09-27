// FC-SEC-002 — Single permission catalog and RBAC contract.
// Fails when the backend catalog, the controller decorators, the frontend
// mirror, or the default role templates disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const backendCatalogPath = join(repoRoot, 'backend/src/auth/permission-catalog.ts');
const backendRoleTemplatesPath = join(repoRoot, 'backend/src/auth/role-templates.ts');
const frontendCatalogPath = join(repoRoot, 'frontend/src/services/permissionsCatalog.ts');
const frontendMatcherPath = join(repoRoot, 'frontend/src/services/permissionMatcher.ts');
const retiredFrontendAliasesPath = join(repoRoot, 'frontend/src/services/permissionAliases.ts');

const read = (path) => readFileSync(path, 'utf8');

const collectFiles = (dir, predicate) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full, predicate);
    return predicate(entry) ? [full] : [];
  });

const collectDecoratedPermissions = () => {
  const used = new Set();
  for (const file of collectFiles(join(repoRoot, 'backend/src'), (n) => n.endsWith('.controller.ts'))) {
    for (const match of read(file).matchAll(/@Permissions\(\s*([^)]+)\)/g)) {
      for (const raw of match[1].split(',')) {
        const value = raw.trim().replace(/^['"`]|['"`]$/g, '');
        if (value) used.add(value);
      }
    }
  }
  return [...used].sort();
};

const catalogIds = (source, key) => {
  const section = source.slice(source.indexOf(key));
  return [...section.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
};

const backendIds = [...new Set(catalogIds(read(backendCatalogPath), 'export const PERMISSION_CATALOG'))].sort();
const frontendIds = [...new Set(catalogIds(read(frontendCatalogPath), 'export const PERMISSIONS_CATALOG'))].sort();

test('backend catalog has entries and unique ids', () => {
  assert.ok(backendIds.length > 0, 'backend catalog is empty');
  assert.equal(new Set(backendIds).size, backendIds.length, 'duplicate permission id in backend catalog');
});

test('frontend mirror contains exactly the backend permission ids', () => {
  const missing = backendIds.filter((id) => !frontendIds.includes(id));
  const extra = frontendIds.filter((id) => !backendIds.includes(id));
  assert.deepEqual(missing, [], `frontend catalog is missing: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `frontend catalog has unknown entries: ${extra.join(', ')}`);
});

test('every controller permission is declared in the backend catalog', () => {
  const used = collectDecoratedPermissions();
  assert.ok(used.length > 0, 'no @Permissions decorators were found');
  const missing = used.filter((id) => !backendIds.includes(id));
  assert.deepEqual(missing, [], `controllers use undeclared permissions: ${missing.join(', ')}`);
});

test('every catalog entry is enforced by at least one route', () => {
  const used = new Set(collectDecoratedPermissions());
  const orphans = backendIds.filter((id) => !used.has(id));
  assert.deepEqual(orphans, [], `catalog entries with no route: ${orphans.join(', ')}`);
});

test('the decorator rejects permissions outside the catalog', () => {
  const decorator = read(join(repoRoot, 'backend/src/auth/decorators/permissions.decorator.ts'));
  assert.match(decorator, /isKnownPermission/);
  assert.match(decorator, /throw new Error/);
});

test('role creation and role updates reject unknown permissions', () => {
  const usersService = read(join(repoRoot, 'backend/src/users/users.service.ts'));
  assert.match(usersService, /resolveCatalogPermissions/);
  assert.match(usersService, /resolvePermissionGrants/, 'must distinguish legacy migration from unknown ids');
  const callSites = usersService.match(/this\.resolveCatalogPermissions\([^)]*\)/g) || [];
  assert.ok(
    callSites.length >= 2,
    `both createRole and updateRolePermissions must validate permissions, found ${callSites.length} call site(s)`,
  );
  assert.ok(
    /throw new BadRequestException\(\s*`Unknown permission/.test(usersService),
    'unknown permissions must be rejected, not silently dropped',
  );
});

test('default role templates only grant catalog permissions', () => {
  const templates = read(backendRoleTemplatesPath);
  const granted = [...templates.matchAll(/'([a-z-]+(?:\.[a-z_*]+)+)'/g)].map((m) => m[1]);
  const moduleKeys = new Set(
    [...read(backendCatalogPath).matchAll(/module:\s*'([a-z-]+)'/g)].map((m) => m[1]),
  );
  const unknown = granted.filter(
    (grant) => grant !== '*' && !grant.endsWith('.*') && !backendIds.includes(grant) && !moduleKeys.has(grant.split('.')[0]),
  );
  assert.deepEqual(unknown, [], `default roles grant unknown permissions: ${unknown.join(', ')}`);
  assert.match(templates, /assertKnownPermissions\(role\.permissions\)/, 'default roles are not validated at import time');
});

test('FC-SEC-005 — the frontend keeps no legacy permission alias table', () => {
  // Legacy id migration belongs to the backend catalog, which runs on the
  // stored role row. While the frontend also carried a 36-entry map, every
  // settings gate depended on a shim that no test tied to the catalog, so
  // removing the shim as "cleanup" would have locked nine screens to SuperAdmin.
  assert.equal(
    existsSync(retiredFrontendAliasesPath),
    false,
    'frontend/src/services/permissionAliases.ts is back; legacy ids must not be translated in the UI',
  );
  assert.ok(existsSync(frontendMatcherPath), 'the canonical frontend matcher is missing');
});

test('the frontend matcher mirrors the backend wildcard semantics', () => {
  const matcher = read(frontendMatcherPath);
  assert.match(matcher, /endsWith\('\.\*'\)/, 'matcher must handle module wildcards');
  assert.match(matcher, /startsWith\(`\$\{prefix\}\.`\)/, 'matcher must scope a wildcard to its own module');
  assert.doesNotMatch(
    matcher,
    /LEGACY_PERMISSION_ALIASES/,
    'the frontend matcher must not reintroduce a legacy alias map',
  );
});

test('the backend serves the catalog so the frontend can consume it', () => {
  const controller = read(join(repoRoot, 'backend/src/auth/auth.controller.ts'));
  assert.match(controller, /@Get\('permissions'\)/);
  assert.match(controller, /PERMISSION_CATALOG/);
  assert.match(controller, /@AllowAuthenticated\(\)/);
});
