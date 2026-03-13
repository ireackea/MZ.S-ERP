# Phase 6.2 JSON to Prisma Cutover

## Summary

This change completes the Prisma cutover for security audit logs, active sessions, and the users-module audit history path.

## What Changed

- switched audit/session persistence to Prisma-backed AuditService runtime paths
- normalized synthetic actor IDs like system and anonymous before writing audit rows to avoid foreign key failures
- removed UsersService dependence on users-audit-log.json and served user audit history from Prisma-backed audit logs
- preserved archived legacy JSON snapshots under backend/backups/archive/phase-6.2-json-cutover
- removed active security/session JSON files from backend/backups
- documented the remaining JSON files that are still valid backup-module metadata versus files that should no longer be treated as runtime truth

## Validation

- backend build passes with npm run build --workspace=backend
- login flow returns 201 and sets feed_factory_jwt cookie
- protected request to /api/users/roles returns 200 using the issued cookie
- Prisma audit_logs shows SESSION_CREATED and PERMISSION_CHECK rows for the verified flow
- Prisma active_sessions shows newly created non-revoked sessions

## Risk Notes

- invitation-emails-outbox.json still exists as a temporary JSON outbox and should move to a durable async job/outbox mechanism later
- backup manifest and schedule JSON remain intentionally owned by the backup module

## Suggested Review Focus

- backend/src/audit/audit.service.ts
- backend/src/auth/jwt-auth.guard.ts
- backend/src/users/users.service.ts
- PHASE_6.2_FINAL_JSON_TO_PRISMA_REPORT_2026-03-13.md
- PHASE_6.2_REMAINING_JSON_CLASSIFICATION_2026-03-13.md