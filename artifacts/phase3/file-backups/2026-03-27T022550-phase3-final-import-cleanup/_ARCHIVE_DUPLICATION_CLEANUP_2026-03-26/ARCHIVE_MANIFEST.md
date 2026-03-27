# Archive Manifest

- Archive date: 2026-03-27
- Archive root: `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26`
- Policy: Copy-only archive. No source file was deleted.

## Archived Files

| Original File | Reason | Archive Date | Current Live Path |
| --- | --- | --- | --- |
| `frontend/src/components/Dashboard.tsx` | Duplicate | `2026-03-27` | `frontend/src/pages/Dashboard.tsx` |
| `frontend/src/components/Reports.tsx` | Duplicate | `2026-03-27` | `frontend/src/pages/Reports.tsx` |
| `frontend/src/components/Settings.tsx` | Legacy | `2026-03-27` | `frontend/src/modules/settings/pages/Settings.tsx` |
| `frontend/src/components/ItemManagement.tsx` | Legacy | `2026-03-27` | `frontend/src/pages/Items.tsx` |
| `frontend/src/components/DailyOperations.tsx` | Legacy | `2026-03-27` | `frontend/src/pages/Operations.tsx` |
| `frontend/src/components/Stocktaking.tsx` | Duplicate | `2026-03-27` | `frontend/src/pages/Stocktaking.tsx` |
| `frontend/src/components/Formulation.tsx` | Wrapper | `2026-03-27` | `frontend/src/pages/Formulation.tsx` |
| `frontend/src/components/OpeningBalancePage.tsx` | Wrapper | `2026-03-27` | `frontend/src/pages/OpeningBalancePage.tsx` |
| `frontend/src/components/BackupCenter.tsx` | Wrapper | `2026-03-27` | `frontend/src/pages/BackupCenter.tsx` |
| `frontend/src/components/AuditLogs.tsx` | Legacy | `2026-03-27` | `frontend/src/modules/settings/components/AuditLogs.tsx` |
| `frontend/src/pages/BackupCenter.tsx` | Wrapper | `2026-03-27` | `frontend/src/pages/BackupCenter.tsx` |

## Notes

- `_ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/modules/settings/` was created and kept isolated for future archive additions.
- The live application now routes through page or module owners instead of direct legacy component routes for the affected paths.