# Phase 6.2 Remaining JSON Classification

## Scope

This note classifies the JSON files that still exist or may reappear under backend/backups after the Prisma cutover work.

## Keep As JSON

- backend/backups/index.json
  This is backup manifest metadata owned by the backup module in backend/src/backup/backup.service.ts.

- backend/backups/schedule.json
  This is backup scheduler configuration owned by the backup module in backend/src/backup/backup.service.ts.

## Keep Temporarily As JSON

- backend/backups/invitation-emails-outbox.json
  This remains a temporary outbox stub for invitation delivery in backend/src/users/users.service.ts.
  It is not a security source of truth, but it should eventually move to a durable async job/outbox table if invitation sending becomes a production workflow.

## Remove / Do Not Treat As Active Source Of Truth

- backend/backups/security-audit-log.json
  Security audit persistence has been cut over to Prisma.

- backend/backups/active-user-sessions.json
  Active session persistence has been cut over to Prisma.

- backend/backups/users-audit-log.json
  UsersService no longer depends on this file and now reads user audit history from Prisma-backed audit logs.

## Final Decision

After Phase 6.2, only backup metadata JSON should remain authoritative in backend/backups.
All security audit, authenticated session, and user audit runtime state should be considered database-backed.