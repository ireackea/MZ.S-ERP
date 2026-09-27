// FC-SEC-005 — no UI gate may name a permission the catalog does not define.
//
// The IAM screens called `hasPermission('settings.view.<x>')` for nine different
// panels. None of those ids exist in the backend catalog, and the backend
// rejects unknown ids when a role is written, so an administrator can never
// grant one. They only resolved because `frontend/src/services/permissionAliases.ts`
// carried a 36-entry legacy map translating them to canonical ids at match time.
//
// That map is what made the defect invisible rather than absent: delete it as
// cleanup and nine settings screens plus the operations inbound/outbound
// controls silently collapse to SuperAdmin-only, with no test failing.
//
// This guard reads the same catalog the backend serves and fails on any
// `hasPermission(...)`/`hasAny([...])` literal that is not a catalog id and not
// an intentional module wildcard. It is deliberately narrow for the reason the
// decimal guard documents: a check that cries wolf gets deleted.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const backendCatalogPath = join(repoRoot, 'backend/src/auth/permission-catalog.ts');

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    // Test files are excluded on purpose. A spec that asserts
    // `hasPermission('settings.view.users') === false` is locking in the
    // fail-closed behaviour and must be able to name a retired id, exactly as
    // the FC-DATA-001 decimal guard excludes its own specs.
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
};

/** Canonical ids exactly as the backend parses them, including underscores. */
const catalogIds = () => {
  const source = readFileSync(backendCatalogPath, 'utf8');
  return new Set([...source.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]));
};

const moduleKeys = () => {
  const source = readFileSync(backendCatalogPath, 'utf8');
  return new Set([...source.matchAll(/module:\s*'([^']+)'/g)].map((m) => m[1]));
};

/** `hasPermission('x')` — a single literal, the shape a reviewer can see. */
const DIRECT_CALL = /hasPermission\(\s*'([^']*)'\s*\)/g;

/** `hasAny(['a','b'])` / `hasAll([...])` — a literal array of gate keys. */
const ARRAY_CALL = /has(?:Any|All)\(\s*\[([^\]]*)\]/g;

/** Tab descriptors `{ key: 'x', label: '…', permission: 'y' }` in Settings. */
const TAB_PERMISSION = /permission:\s*'([^']+)'/g;

const isAcceptable = (id, catalog, modules) => {
  if (!id) return true; // a falsy key short-circuits to false; nothing to check
  if (id === '*') return true;
  if (catalog.has(id)) return true;
  if (id.endsWith('.*') && modules.has(id.slice(0, -2))) return true;
  return false;
};

describe('FC-SEC-005 UI permission gates reference real catalog ids', () => {
  const catalog = catalogIds();
  const modules = moduleKeys();
  const files = walk(join(repoRoot, 'frontend/src'));

  it('parses a non-trivial catalog so the guard is actually running', () => {
    assert.ok(catalog.size >= 50, `expected the full catalog, parsed ${catalog.size}`);
  });

  it('every hasPermission() literal is a catalog id or a module wildcard', () => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DIRECT_CALL)) {
        const id = match[1];
        if (!isAcceptable(id, catalog, modules)) {
          offenders.push(`${file.replace(repoRoot, '.')}: hasPermission('${id}')`);
        }
      }
    }
    assert.deepEqual(offenders, [], `UI gates name permissions that do not exist:\n  ${offenders.join('\n  ')}`);
  });

  it('every hasAny()/hasAll() literal is a catalog id or a module wildcard', () => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ARRAY_CALL)) {
        for (const id of match[1].matchAll(/'([^']+)'/g)) {
          if (!isAcceptable(id[1], catalog, modules)) {
            offenders.push(`${file.replace(repoRoot, '.')}: hasAny/hasAll('${id[1]}')`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `UI gate arrays name permissions that do not exist:\n  ${offenders.join('\n  ')}`);
  });

  it('every Settings tab permission is a catalog id or a module wildcard', () => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(TAB_PERMISSION)) {
        const id = match[1];
        if (!isAcceptable(id, catalog, modules)) {
          offenders.push(`${file.replace(repoRoot, '.')}: permission: '${id}'`);
        }
      }
    }
    assert.deepEqual(offenders, [], `Settings tabs name permissions that do not exist:\n  ${offenders.join('\n  ')}`);
  });

  it('no UI file reintroduces a role-permission fallback that widens grants', () => {
    // The fallback replaced an empty server permission list with a hand-written
    // Admin/SuperAdmin grant list, so a zero-permission session rendered admin
    // tabs the API would then refuse. Fail-open display is the defect.
    const offenders = [];
    for (const file of files) {
      if (file.endsWith(join('unified-iam', 'shared.ts'))) continue;
      const source = readFileSync(file, 'utf8');
      if (/ROLE_PERMISSION_FALLBACKS|resolveRoleFallbackPermissions/.test(source)) {
        offenders.push(file.replace(repoRoot, '.'));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `fail-open role permission fallbacks are back in use:\n  ${offenders.join('\n  ')}`,
    );
  });
});
