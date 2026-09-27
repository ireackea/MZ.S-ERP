// Gate 0 — the system reset could not delete anything, and the two safety nets
// it does have were both optional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const service = readFileSync(join(repoRoot, 'backend/src/monitoring/monitoring.service.ts'), 'utf8');

test('gate 0 the reset cannot silently skip a table it failed to clear', () => {
  // The original reached for models that no longer exist with
  // `?.deleteMany?.()` inside a try/catch, then pushed the name onto
  // tablesAffected. So a reset reported clearing RolePermission and UserRole
  // having touched neither — the one artefact an operator would use to judge
  // what happened.
  assert.doesNotMatch(
    service,
    /deleteMany\?\.\(\)\};\s*tables\.push/,
    'an optional deleteMany must not be followed by a report entry claiming it ran',
  );
  assert.doesNotMatch(
    service,
    /catch \{ \/\* optional/,
    'the reset must not swallow a delete failure and carry on reporting success',
  );

  // Row counts, not names.
  assert.match(
    service,
    /rowsDeleted:\s*Number\(count/,
    'the report must carry how many rows went, not just which table',
  );
  assert.match(service, /absentModels/, 'a model the schema no longer has must be reported as absent');
  assert.match(service, /keptSuperAdminId/, 'the surviving account must be reported, not guessed at');
});

test('gate 0 the pre-reset backup is still optional, and that is deliberate', () => {
  // This is Gate 2.3 and it is NOT fixed here. Asserted so the gap is tracked in
  // the suite rather than only in a document: a reset that cannot fail because
  // its safety net is best-effort is the next thing to change, and a reader
  // should not have to find that in a plan file.
  assert.match(
    service,
    /createBackup !== false/,
    'still defaults to attempting a backup, but `false` is still accepted',
  );
  assert.match(
    service,
    /non-fatal/,
    'a failed backup is still logged and ignored — Gate 2.3 must make this fatal',
  );
});

test('gate 0 a foreign-key refusal names the blocker instead of a bare 500', () => {
  assert.match(service, /translateResetFailure/);
  assert.match(
    service,
    /P2003/,
    'a Prisma foreign-key violation must be recognised, not passed through',
  );
  assert.match(
    service,
    /constraint:\\s\*`\?\(\[A-Za-z0-9_\]/,
    'the constraint name must be extracted so the operator learns which table blocks them',
  );
  assert.match(service, /SYSTEM_RESET_BLOCKED_BY_REFERENCES/);
  assert.match(service, /SYSTEM_RESET_BLOCKED_BY_SALES/);
});

test('gate 0 the reset does not delete a SuperAdmin it cannot account for', () => {
  // `full` keeps one SuperAdmin. The keeper is chosen by age, not by whether
  // anyone knows its password, so the response has to say which account it was —
  // otherwise an operator who just deleted their own access finds out from a
  // login failure.
  assert.match(service, /orderBy:\s*\{\s*createdAt:\s*'asc'\s*\}/);
  assert.match(
    service,
    /NOT:\s*\{\s*id:\s*keptSuperAdminId\s*\}/,
    'the keeper must be excluded by id, and the id must reach the response',
  );
});
