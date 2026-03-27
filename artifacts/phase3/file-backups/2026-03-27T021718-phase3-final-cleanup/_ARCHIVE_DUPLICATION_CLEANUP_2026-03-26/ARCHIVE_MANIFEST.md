# Archive Manifest

- Archive date: 2026-03-27
- Archive root: `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26`
- Policy: Copy-only archive. No source file was deleted.

## Archived Files

| Original Path | Archived Path | Reason |
| --- | --- | --- |
| `frontend/src/components/Dashboard.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/Dashboard.tsx` | Duplicate |
| `frontend/src/components/Reports.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/Reports.tsx` | Duplicate |
| `frontend/src/components/Settings.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/Settings.tsx` | Legacy |
| `frontend/src/components/ItemManagement.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/ItemManagement.tsx` | Legacy |
| `frontend/src/components/DailyOperations.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/DailyOperations.tsx` | Legacy |
| `frontend/src/components/Stocktaking.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/Stocktaking.tsx` | Duplicate |
| `frontend/src/components/Formulation.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/Formulation.tsx` | Wrapper |
| `frontend/src/components/OpeningBalancePage.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/OpeningBalancePage.tsx` | Wrapper |
| `frontend/src/components/BackupCenter.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/BackupCenter.tsx` | Wrapper |
| `frontend/src/components/AuditLogs.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/components/AuditLogs.tsx` | Legacy |
| `frontend/src/pages/BackupCenter.tsx` | `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/pages/BackupCenter.tsx` | Wrapper |

## Notes

- `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/modules/settings/` was created and kept isolated for future archive additions.
- The live application now routes through page or module owners instead of direct legacy component routes for the affected paths.