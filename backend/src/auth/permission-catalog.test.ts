import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ALL_PERMISSION_IDS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  assertKnownPermissions,
  isKnownPermission,
  isKnownPermissionGrant,
  isPermissionGranted,
  migratePermissionGrants,
  resolveCanonicalRole,
  resolvePermissionGrants,
} from './permission-catalog';
import { DEFAULT_ROLES } from './role-templates';

// Resolved from this file so the test passes whether vitest runs from backend/ or the repo root.
const backendRoot = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');

const collectControllerFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectControllerFiles(full);
    return entry.endsWith('.controller.ts') ? [full] : [];
  });

const collectDecoratedPermissions = (): string[] => {
  const controllers = collectControllerFiles(join(backendRoot, 'src'));
  const used = new Set<string>();
  for (const file of controllers) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/@Permissions\(\s*([^)]+)\)/g)) {
      for (const raw of match[1].split(',')) {
        const value = raw.trim().replace(/^['"`]|['"`]$/g, '');
        if (value) used.add(value);
      }
    }
  }
  return [...used].sort();
};

describe('FC-SEC-002 permission catalog', () => {
  it('declares a unique, well-formed id for every entry', () => {
    expect(PERMISSION_CATALOG.length).toBeGreaterThan(0);
    expect(new Set(ALL_PERMISSION_IDS).size).toBe(PERMISSION_CATALOG.length);

    for (const entry of PERMISSION_CATALOG) {
      expect(entry.id).toMatch(/^[a-z-]+(\.[a-z_]+)+$/);
      expect(entry.id.startsWith(`${entry.module}.`)).toBe(true);
      expect(entry.action).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      // Every entry documents either a route or is explicitly API-only.
      expect(Boolean(entry.route) || entry.apiOnly === true).toBe(true);
    }
  });

  it('covers every permission used by a controller decorator', () => {
    const used = collectDecoratedPermissions();
    expect(used.length).toBeGreaterThan(0);

    const missing = used.filter((permission) => !isKnownPermission(permission));
    expect(missing, `Permissions used in controllers but absent from the catalog: ${missing.join(', ')}`).toEqual([]);
  });

  it('flags catalog entries that no route actually requires', () => {
    const used = new Set(collectDecoratedPermissions());
    const orphans = ALL_PERMISSION_IDS.filter((id) => !used.has(id));
    expect(orphans, `Catalog entries with no enforcing route: ${orphans.join(', ')}`).toEqual([]);
  });

  it('groups every permission under its module with a valid wildcard', () => {
    const grouped = new Set(PERMISSION_MODULES.flatMap((module) => module.permissions));
    expect([...grouped].sort()).toEqual([...ALL_PERMISSION_IDS].sort());

    for (const module of PERMISSION_MODULES) {
      expect(module.wildcard).toBe(`${module.key}.*`);
      expect(isKnownPermissionGrant(module.wildcard)).toBe(true);
      expect(module.permissions.length).toBeGreaterThan(0);
      for (const permission of module.permissions) {
        expect(permission.startsWith(`${module.key}.`)).toBe(true);
      }
    }
  });

  it('accepts known permissions and rejects unknown grants', () => {
    expect(isKnownPermissionGrant('*')).toBe(true);
    expect(isKnownPermissionGrant('items.view')).toBe(true);
    expect(isKnownPermissionGrant('items.*')).toBe(true);
    expect(isKnownPermissionGrant('inventory.*')).toBe(true);
    expect(isKnownPermissionGrant('items.teleport')).toBe(false);
    expect(isKnownPermissionGrant('inventory.view.stock')).toBe(false);
    expect(isKnownPermissionGrant('ghosts.*')).toBe(false);
    expect(isKnownPermissionGrant('')).toBe(false);

    expect(() => assertKnownPermissions(['items.view', 'ghosts.ride'])).toThrow(/Unknown permission/);
    expect(() => assertKnownPermissions(['items.view', 'items.*'])).not.toThrow();
  });

  it('mirrors the backend guard wildcard semantics', () => {
    expect(isPermissionGranted(['*'], 'items.view')).toBe(true);
    expect(isPermissionGranted(['items.*'], 'items.view')).toBe(true);
    expect(isPermissionGranted(['items.view'], 'items.view')).toBe(true);
    expect(isPermissionGranted(['items.view'], 'items.update')).toBe(false);
    expect(isPermissionGranted(['inventory.*'], 'inventory.view.stocktaking')).toBe(true);
    expect(isPermissionGranted(['stocktaking.*'], 'inventory.view.stocktaking')).toBe(false);
  });

  it('only ships default roles whose grants are all in the catalog', () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.permissions.length).toBeGreaterThan(0);
      expect(() => assertKnownPermissions(role.permissions)).not.toThrow();
    }
    expect(new Set(DEFAULT_ROLES.map((role) => role.name)).size).toBe(DEFAULT_ROLES.length);
  });

  it('migrates a legacy grant forward without becoming a bypass', () => {
    // Legacy ids resolve to canonical ones instead of being rejected...
    expect(migratePermissionGrants(['settings.view'])).toEqual(['settings.view.general']);
    expect(migratePermissionGrants(['inventory.view.items', 'items.view'])).toEqual(['items.view']);
    expect(migratePermissionGrants(['users.view.management'])).toEqual(['users.view']);

    // ...while a genuinely unknown id is reported, never silently dropped.
    const result = resolvePermissionGrants(['items.view', 'items.teleport']);
    expect(result.grants).toEqual(['items.view']);
    expect(result.unknown).toEqual(['items.teleport']);

    // A legacy id that maps nowhere is also reported.
    expect(resolvePermissionGrants(['ghosts.ride']).unknown).toEqual(['ghosts.ride']);

    // Wildcards survive migration untouched.
    expect(migratePermissionGrants(['items.*'])).toEqual(['items.*']);
    expect(migratePermissionGrants(['*'])).toEqual(['*']);
  });

  it('migrates legacy role aliases to canonical names', () => {
    expect(resolveCanonicalRole('superadmin')).toBe('SuperAdmin');
    expect(resolveCanonicalRole('SUPER_ADMIN')).toBe('SuperAdmin');
    expect(resolveCanonicalRole('administrator')).toBe('Admin');
    expect(resolveCanonicalRole('warehouse_manager')).toBe('Manager');
    expect(resolveCanonicalRole('storekeeper')).toBe('Operator');
    expect(resolveCanonicalRole('customer')).toBe('Viewer');
    expect(resolveCanonicalRole('  ')).toBeNull();
    expect(resolveCanonicalRole('unknown_role')).toBeNull();
  });
});
