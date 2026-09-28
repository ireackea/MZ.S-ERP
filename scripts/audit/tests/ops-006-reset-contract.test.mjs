// Gate 2 — the reset asked for a password, a justification and a typed code, and
// destroyed the database while two of its own safety nets were optional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const service = readFileSync(join(repoRoot, 'backend/src/monitoring/monitoring.service.ts'), 'utf8');
const controller = readFileSync(join(repoRoot, 'backend/src/monitoring/monitoring.controller.ts'), 'utf8');
const dto = readFileSync(join(repoRoot, 'backend/src/monitoring/dto/system-reset.dto.ts'), 'utf8');
const schema = readFileSync(join(repoRoot, 'backend/prisma/schema.prisma'), 'utf8');

/** Comments carry the very names the guard forbids, so they come out first. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The AuditLog model's field names, straight out of the schema. */
const auditLogModelFields = () => {
  const model = schema.slice(schema.indexOf('model AuditLog {'));
  return [...model.slice(0, model.indexOf('\n}')).matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
};

/** The audit_logs column names, which are not the same list. */
const auditLogColumnNames = () => {
  const model = schema.slice(schema.indexOf('model AuditLog {'));
  return [...model.slice(0, model.indexOf('\n}')).matchAll(/@map\("(\w+)"\)/g)].map((m) => m[1]);
};
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

test('FC-AUD-002 the reset record is built from the model, not from the column names', () => {
  // The bug this guards was invisible to every test above it. The row used the
  // column names `actorId` and `message`, put an object in `metadata`, and cast
  // the data object with `as any`, so it compiled, the guard passed, and the
  // reset died at run time in the middle of the transaction with
  //
  //   Unknown argument `actorId`. Did you mean `actor`?
  //
  // Matching the source text for the string "tx.auditLog.create" is not enough.
  // The data it writes has to be checked against the model.

  const body = service.slice(service.indexOf('private async executeScopedReset'));
  const tx = body.slice(0, body.indexOf('\n  async '));
  const createAt = tx.indexOf('tx.auditLog.create');
  assert.notEqual(createAt, -1, 'the reset must still write its record on the transaction client');

  // Comments are stripped first. The call carries a comment explaining that
  // `actorId` and `message` are the column names that broke it, and a guard that
  // reads those words as keys fails on its own explanation.
  const call = stripComments(tx.slice(createAt, tx.indexOf('});', createAt) + 3));

  // The data must come from the shared writer. That is the whole mechanism: a
  // typed input cannot be given a Prisma field that does not exist, so the class
  // of bug is unwriteable rather than untested.
  //
  // Checking the call for column names would be wrong — `message` is a legitimate
  // key of the writer's own input, and the writer maps it to `details`.
  assert.match(
    call,
    /data:\s*buildAuditRow\(/,
    'the record must be built by the shared writer, so one place knows the field names',
  );
  assert.doesNotMatch(call, /\bas any\b/, 'the audit data object must not be cast');

  // The writer is typed against Prisma, and it is the only place allowed to know
  // the column names, because it is the only place that translates them.
  const builder = stripComments(
    readFileSync(join(repoRoot, 'backend/src/audit/audit-row.ts'), 'utf8'),
  );
  assert.doesNotMatch(builder, /\bas any\b/, 'audit-row.ts must not cast its way past the type error');
  assert.match(
    builder,
    /AuditLogUncheckedCreateInput/,
    'the writer must type its result as the Prisma create input, which is what would have caught this',
  );
  assert.match(
    builder,
    /userId:\s*normalizeActorId\(/,
    'actorId is the column; the field is userId, and a system actor must become NULL rather than a broken foreign key',
  );
  assert.match(
    builder,
    /details:/,
    'message is the column; the field is details',
  );
  // The object it actually returns is what reaches Prisma, so that is the object
  // whose keys must be model fields. The input type above it is allowed to speak
  // the caller's language — including `actorId` and `message`, which is the whole
  // point of a translating builder.
  const returned = builder.slice(builder.indexOf('AuditLogUncheckedCreateInput'));
  assert.match(returned, /=>\s*\(\{/, 'the builder must return an object literal, not assemble it elsewhere');
  const literal = returned.slice(returned.indexOf('=> ({'));
  const fields = auditLogModelFields();
  for (const [, key] of literal.matchAll(/^\s{2}(\w+)\s*[:,}]/gm)) {
    assert.ok(
      fields.includes(key),
      `audit-row.ts returns "${key}", which is not an AuditLog field; the columns are ${auditLogColumnNames().join(', ')}`,
    );
  }
  assert.ok(
    auditLogModelFields().includes('userId') && auditLogModelFields().includes('details'),
    'the guard is only meaningful if the model really is userId/details',
  );
  assert.ok(
    auditLogColumnNames().includes('actorId') && auditLogColumnNames().includes('message'),
    'the guard is only meaningful if the columns really are the names that broke it',
  );

  // The same mistake in the generic audit path produced rows with a NULL actor,
  // and moving the write into one place must not quietly drop the redaction that
  // path used to apply.
  const auditService = stripComments(
    readFileSync(join(repoRoot, 'backend/src/audit/audit.service.ts'), 'utf8'),
  );
  const logBody = auditService.slice(auditService.indexOf('async log('));
  assert.match(
    logBody.slice(0, 2500),
    /buildAuditRow\(/,
    'AuditService.log must use the shared writer',
  );
  assert.match(
    builder,
    /redactMetadata/,
    'the writer must keep the redaction AuditService.log used to apply',
  );
});

test('FC-AUD-002 has a test that runs the success path, not only one that reads it', () => {
  // The unit suite passed 211/211 while the live reset returned 500, because
  // nothing executed the write. A guard that only reads source is how that
  // happened, so the suite must contain a test that drives a real reset.
  const spec = join(repoRoot, 'tests/e2e/reset-success.spec.ts');
  const text = readFileSync(spec, 'utf8');
  assert.match(text, /SYSTEM_RESET_SUCCESS/, 'the spec must read back the record the reset leaves');
  assert.match(text, /toBe\(201\)/, 'the spec must assert the reset succeeds, not just that it refuses');
  assert.match(text, /'Inventory'|Item/, 'the spec must assert data was actually cleared');
  // And it must not be pointed at the real database.
  assert.doesNotMatch(
    text,
    /127\.0\.0\.1:3001|localhost:3001/,
    'the destructive spec must never target the running API',
  );

  // The spec only protects anything if it is actually part of a run. Every other
  // e2e spec here is reached through a package.json script, and this one was
  // created without one — a test nothing invokes is a comment.
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const script = Object.entries(pkg.scripts || {}).find(([, value]) =>
    String(value).includes('tests/e2e/reset-success.spec.ts'),
  );
  assert.ok(
    script,
    'no npm script runs tests/e2e/reset-success.spec.ts, so nothing will ever execute it',
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
