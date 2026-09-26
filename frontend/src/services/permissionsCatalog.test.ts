import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_IDS,
  FULL_ACCESS_TOKEN,
  PERMISSIONS_CATALOG,
  countGrantedInGroup,
  isPermissionGranted,
} from './permissionsCatalog';
import {
  diffAgainstBundledCatalog,
  hasCatalogDrift,
} from './permissionCatalogSync';
import { expandRequestedPermissions, hasGrantedPermission } from './permissionAliases';

describe('FC-SEC-002 frontend permission catalog mirror', () => {
  it('has unique, well-formed ids grouped under their module', () => {
    expect(ALL_PERMISSION_IDS.length).toBeGreaterThan(0);
    expect(new Set(ALL_PERMISSION_IDS).size).toBe(ALL_PERMISSION_IDS.length);

    for (const group of PERMISSIONS_CATALOG) {
      expect(group.wildcard).toBe(`${group.key}.*`);
      expect(group.permissions.length).toBeGreaterThan(0);
      for (const permission of group.permissions) {
        expect(permission.id.startsWith(`${group.key}.`)).toBe(true);
        expect(permission.label).toBeTruthy();
        expect(permission.description).toBeTruthy();
      }
    }
  });

  it('matches the backend guard wildcard semantics', () => {
    expect(isPermissionGranted(['*'], 'items.view')).toBe(true);
    expect(isPermissionGranted(['items.*'], 'items.view')).toBe(true);
    expect(isPermissionGranted(['items.view'], 'items.view')).toBe(true);
    expect(isPermissionGranted(['items.view'], 'items.update')).toBe(false);
    expect(isPermissionGranted(['inventory.*'], 'inventory.view.stocktaking')).toBe(true);
  });

  it('counts granted permissions per group', () => {
    const group = PERMISSIONS_CATALOG.find((entry) => entry.key === 'items')!;
    const all = group.permissions.map((permission) => permission.id);
    expect(countGrantedInGroup(['*'], group)).toBe(all.length);
    expect(countGrantedInGroup(['items.view'], group)).toBe(1);
    expect(countGrantedInGroup([], group)).toBe(0);
  });

  it('migrates a legacy grant to its canonical catalog id', () => {
    expect(expandRequestedPermissions('inventory.view.items')).toEqual(['inventory.view.items', 'items.view']);
    expect(hasGrantedPermission(['items.view'], 'inventory.view.items')).toBe(true);
    expect(hasGrantedPermission(['items.*'], 'settings.view.users')).toBe(false);
    expect(hasGrantedPermission(['users.view'], 'settings.view.users')).toBe(true);
    expect(hasGrantedPermission([FULL_ACCESS_TOKEN], 'anything.at_all')).toBe(true);
  });

  it('reports drift against the backend catalog', () => {
    const clean = diffAgainstBundledCatalog({
      total: ALL_PERMISSION_IDS.length,
      permissions: ALL_PERMISSION_IDS.map((id) => ({ id })) as any,
      modules: [],
    });
    expect(clean).toEqual({ missingInFrontend: [], unknownInFrontend: [] });
    expect(hasCatalogDrift(clean)).toBe(false);

    const drifted = diffAgainstBundledCatalog({
      total: 0,
      permissions: [...ALL_PERMISSION_IDS, 'items.ghost'].map((id) => ({ id })) as any,
      modules: [],
    });
    expect(drifted.missingInFrontend).toEqual(['items.ghost']);
    expect(hasCatalogDrift(drifted)).toBe(true);
    expect(hasCatalogDrift(null)).toBe(false);
  });
});
