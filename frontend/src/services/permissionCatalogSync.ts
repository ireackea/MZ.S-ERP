/**
 * FC-SEC-002 — runtime access to the single backend permission catalog.
 *
 * The bundled mirror in `permissionsCatalog.ts` lets the UI render before any
 * network call. This service fetches the authoritative catalog from
 * `GET /auth/permissions` and reports drift, so a backend permission that the
 * frontend does not know about is visible instead of silently unreachable.
 */
import apiClient from '@api/client';
import { ALL_PERMISSION_IDS, PERMISSIONS_CATALOG } from './permissionsCatalog';

export type ServerPermissionCatalog = {
  total: number;
  permissions: Array<{
    id: string;
    module: string;
    action: string;
    label: string;
    description: string;
    route: string;
    apiOnly?: boolean;
  }>;
  modules: Array<{ key: string; label: string; wildcard: string; permissions: string[] }>;
};

export type CatalogDrift = {
  missingInFrontend: string[];
  unknownInFrontend: string[];
};

const bundled = new Set(ALL_PERMISSION_IDS);

export const diffAgainstBundledCatalog = (server: ServerPermissionCatalog): CatalogDrift => {
  const serverIds = new Set((server.permissions || []).map((permission) => permission.id));
  return {
    missingInFrontend: [...serverIds].filter((id) => !bundled.has(id)).sort(),
    unknownInFrontend: ALL_PERMISSION_IDS.filter((id) => !serverIds.has(id)).sort(),
  };
};

let cached: ServerPermissionCatalog | null = null;

export const fetchPermissionCatalog = async (options: { force?: boolean } = {}): Promise<ServerPermissionCatalog | null> => {
  if (cached && !options.force) return cached;
  try {
    const response = await apiClient.get<ServerPermissionCatalog>('/auth/permissions');
    if (response.data?.permissions?.length) {
      cached = response.data;
    }
    return cached;
  } catch {
    // Offline or unauthenticated: the bundled mirror remains authoritative for rendering.
    return null;
  }
};

/** Convenience for startup: fetch, and log drift if the backend has moved on. */
export const syncPermissionCatalog = async (): Promise<CatalogDrift | null> => {
  const server = await fetchPermissionCatalog({ force: true });
  if (!server) return null;
  const drift = diffAgainstBundledCatalog(server);
  if (drift.missingInFrontend.length || drift.unknownInFrontend.length) {
    console.warn(
      '[FC-SEC-002] permission catalog drift — regenerate frontend/src/services/permissionsCatalog.ts',
      drift,
    );
  }
  return drift;
};

export const hasCatalogDrift = (drift: CatalogDrift | null | undefined): boolean =>
  Boolean(drift && (drift.missingInFrontend.length > 0 || drift.unknownInFrontend.length > 0));

export const moduleCount = (): number => PERMISSIONS_CATALOG.length;
