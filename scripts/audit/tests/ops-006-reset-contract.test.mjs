// Gate 2 — the reset asked for a password, a justification and a typed code, and
// destroyed the database while two of its own safety nets were optional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const service = readFileSync(join(repoRoot, 'backend/src/monitoring/monitoring.service.ts'), 'utf8');
const controller = readFileSync(join(repoRoot, 'backend/src/monitoring/monitoring.controller.ts'), 'utf8');
const dto = readFileSync(join(repoRoot, 'backend/src/monitoring/dto/system-reset.dto.ts'), 'utf8');
const migration = readFileSync(
  join(repoRoot, 'backend/prisma/migrations/20260927110000_audit_log_indexes/migration.sql'),
  'utf8',
);

test('gate 2.2 the reset can be inspected before anything is typed', () => {
  assert.match(service, /async previewSystemReset/);
  assert.match(controller, /admin\/reset-system\/preview/);
  assert.match(dto, /class ResetPreviewDto/);

  // Counts, not prose. The scope descriptions were English sentences and could not
  // be wrong in a way anyone could check.
  assert.match(service, /counts: targets/);
  assert.match(service, /totalRows/);
  // "Will this delete me" is the fact an operator cannot know, because the keeper
  // is chosen by age rather than by whether anyone knows its password.
  assert.match(service, /actorWillBeDeleted/);
  // The refusal, before the password is asked for rather than after.
  assert.match(service, /blockedBy/);

  const preview = service.slice(service.indexOf('async previewSystemReset'));
  const end = preview.indexOf('\n  async ');
  assert.doesNotMatch(
    preview.slice(0, end),
    /deleteMany|truncate|executeScopedReset\(/,
    'the preview must not write: its whole purpose is to be called before anything is destroyed',
  );
});

test('gate 2.3 a backup without which the reset is refused, not optional', () => {
  assert.doesNotMatch(
    service,
    /non-fatal/,
    'a failed backup that is logged and ignored is how a reset destroys data with no way back',
  );

  // Refusal 1: no "no backup" reset for a scope that destroys identity.
  assert.match(service, /SYSTEM_RESET_BACKUP_REQUIRED/);
  assert.match(
    service,
    /dto\.createBackup === false && requiresBackup/,
    'the option must be rejected outright, not merely defaulted',
  );

  // Refusal 2: a failed backup aborts the reset, and says the data did not change.
  assert.match(service, /SYSTEM_RESET_BACKUP_FAILED/);
  assert.match(service, /البيانات لم تتغيّر/);

  // Refusal 3: a backup that is not restorable is not a safety net. This only
  // became checkable in Gate 1.2, where `integrity` stopped being a constant.
  assert.match(service, /SYSTEM_RESET_BACKUP_NOT_RESTORABLE/);
  assert.match(
    service,
    /const restorable = created\?\.integrity === 'verified' && created\?\.complete !== false/,
  );

  // Every refusal is itself recorded, so "someone tried to reset without a backup"
  // is findable afterwards.
  for (const action of [
    'SYSTEM_RESET_REFUSED_NO_BACKUP',
    'SYSTEM_RESET_REFUSED_UNRESTORABLE_BACKUP',
  ]) {
    assert.ok(service.includes(action), `${action} must be recorded, not just refused`);
  }
});

test('gate 2.4 the reset record is inside the reset, not after it', () => {
  // The record used to be written after the deletion committed, through a helper
  // that swallowed its own failures: the system could destroy everything and
  // document nothing, leaving one line in a container log.
  const body = service.slice(service.indexOf('private async executeScopedReset'));
  const end = body.indexOf('\n  async ');
  const tx = body.slice(0, end);

  assert.match(tx, /tx\.auditLog\.create\(/, 'the record must be written on the transaction client');
  assert.match(tx, /SYSTEM_RESET_SUCCESS/);
  // Written after the audit table is cleared, or the reset would delete its own
  // record — which is what clearing audit_logs in this very transaction implies.
  const clearAt = tx.indexOf("stage: 'audit'");
  const recordAt = tx.indexOf('tx.auditLog.create');
  assert.ok(
    recordAt === -1 || clearAt === -1 || recordAt > clearAt,
    'the record must come after any audit-table clearing, or it is deleted with it',
  );

  // And the old post-commit copy is gone, so the fact is not written twice by two
  // paths that can disagree.
  const perform = service.slice(service.indexOf('async performSystemReset'));
  const performEnd = perform.indexOf('\n  private ');
  const section = perform.slice(0, performEnd > 0 ? performEnd : 6000);
  const afterCommit = section.slice(section.indexOf('executeScopedReset(dto.scope'));
  assert.doesNotMatch(
    afterCommit,
    /recordResetAudit\([\s\S]{0,200}SYSTEM_RESET_SUCCESS/,
    'the success record is now written in-transaction; a second copy can still fail silently',
  );
});

test('gate 2.8 the audit trail is indexed for the queries this section actually makes', () => {
  // `targetUserId` is the only filter GET /users/:id/audit uses, and it is written
  // on every user-management action. It was unindexed.
  assert.match(migration, /audit_logs_targetUserId_idx/);

  // `search` is five ILIKE '%…%' predicates. A btree cannot serve them, and the
  // count() repeats the same where clause, so it scanned twice per request.
  assert.match(migration, /pg_trgm/);
  assert.match(migration, /gin_trgm_ops/);

  // The Prisma field is `details`; the column is `message` via @map. Indexing the
  // field name failed with "column details does not exist" and left a partial
  // migration behind, because the statements before it had already run.
  assert.match(migration, /"message" gin_trgm_ops/);
  assert.doesNotMatch(migration, /"details" gin_trgm_ops/);
  assert.match(migration, /IF NOT EXISTS/, 'a re-run after a partial failure must be safe');
});
