# Backup Dashboard Changes Report

Date: 2026-03-26
Repository: MZ.S-ERP
Scope: Official remediation of the Settings Backup Dashboard and its backend restore pipeline.

## Files Changed

1. backend/src/backup/backup.service.ts
2. frontend/src/components/BackupCenter.tsx
3. frontend/src/hooks/usePermissions.ts
4. frontend/src/services/iamService.ts
5. tests/e2e/backup-dashboard.spec.ts

## Backend Remediation

### Root Cause Corrected

The backup and restore service still assumed that production backups for non-config payloads depended on a SQLite database file. The runtime environment is PostgreSQL through Prisma, so restore preview and apply flows failed whenever the SQLite artifact did not exist.

### Official Fix Applied

1. Introduced a Prisma-native snapshot payload type for backup data.
2. Updated backup payload generation so that:
   - SQLite file snapshots are used when an actual SQLite database file exists.
   - Prisma logical snapshots are used when the runtime datastore is PostgreSQL.
3. Added restore logic for Prisma snapshots.
4. Added PostgreSQL sequence synchronization after restore to prevent identity drift on Item, OpeningBalance, and Transaction tables.

### Result

Restore preview and restore apply are now valid in the actual PostgreSQL runtime used by this system.

## Frontend Remediation

### Root Cause Corrected

The Backup Dashboard had a combination of UI encoding issues, mismatched permission coverage, incomplete schedule controls, and a runtime crash caused by chart usage in the lazy-loaded settings flow.

### Official Fix Applied

1. Replaced corrupted and mixed-language UI strings with production Arabic text.
2. Added explicit permission gating for:
   - create
   - schedule
   - restore
   - download
   - delete
3. Added schedule support for:
   - weekly execution day
   - monthly execution day
4. Replaced the unstable chart section with deterministic storage summary cards.
5. Clarified labels for backup type, actor, restore confirmation, and schedule state.

### Result

The settings backup tab now renders without the previous module crash and aligns with backend permission enforcement.

## Permission Model Alignment

The frontend permission model was expanded to include:

1. backup.schedule
2. backup.download
3. backup.delete

These were added to both the permission catalog and the settings backup alias mapping so that page visibility and action-level authorization reflect the backend contract.

## Verification Already Completed Before Additional Sweep

1. Frontend build passed.
2. Backend build passed.
3. Dedicated end-to-end validation for the backup dashboard passed after the PostgreSQL-compatible restore fix.

## Deliverable State

The system now contains:

1. A repaired Backup Dashboard UI.
2. Backend restore logic compatible with the deployed PostgreSQL architecture.
3. A dedicated end-to-end regression test for backup scheduling, create, download, preview restore, apply restore, and delete operations.