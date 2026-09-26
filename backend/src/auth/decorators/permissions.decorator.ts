// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
// FC-SEC-002 — decorator validates every permission against the single catalog.
import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_METADATA_KEY } from '../auth.constants';
import { isKnownPermission } from '../permission-catalog';

export const Permissions = (...permissions: string[]) => {
  const unknown = permissions.filter((permission) => !isKnownPermission(permission));
  if (unknown.length) {
    // Fail fast at module load so a typo can never reach production.
    throw new Error(
      `Permissions(${unknown.join(', ')}) is not defined in the permission catalog. ` +
        'Add the entry to backend/src/auth/permission-catalog.ts first.',
    );
  }
  return SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
};
