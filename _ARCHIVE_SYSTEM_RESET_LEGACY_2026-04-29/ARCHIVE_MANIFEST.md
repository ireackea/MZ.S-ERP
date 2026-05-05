# ARCHIVE — System Reset Legacy (2026-04-29)

Archived as part of the **Advanced System Reset Module v2 — Multi-Layer Security** rebuild.

## Replaced files

| File | Rebuilt as |
|------|------------|
| `frontend/src/modules/settings/components/SystemReset.tsx` | New multi-stage UI with framer-motion, RTL, scope selection, two-factor confirmation, progress feedback |
| `frontend/src/services/systemResetService.ts` | Extended API with `requestChallenge` + scoped `executeReset` |
| `backend/src/monitoring/monitoring.controller.ts` | New `POST /admin/reset-system/challenge` endpoint, IP/UA forwarding |
| `backend/src/monitoring/monitoring.service.ts` | Scope-based reset (`full` / `data` / `inventory` / `audit`), pre-backup, structured AuditLog entries, IP/UA persistence |
| `backend/src/monitoring/dto/system-reset.dto.ts` | New `ResetChallengeDto` + extended `SystemResetDto` (scope, reason, challengeCode, createBackup) |

## Why archived (not deleted)

Per Phase 6+ archival policy, all replaced source remains discoverable for forensic / rollback purposes.
Do **NOT** import from this directory in production code.
