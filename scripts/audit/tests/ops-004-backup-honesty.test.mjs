// Gate 1 — the backup surface reported success it had not earned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const service = readFileSync(join(repoRoot, 'backend/src/backup/backup.service.ts'), 'utf8');
const pgDump = readFileSync(join(repoRoot, 'backend/src/backup/pg-dump.ts'), 'utf8');
const headroom = readFileSync(join(repoRoot, 'backend/src/backup/disk-headroom.ts'), 'utf8');
const reconcile = readFileSync(join(repoRoot, 'backend/src/backup/backup-reconcile.ts'), 'utf8');
const lock = readFileSync(join(repoRoot, 'backend/src/backup/manifest-lock.ts'), 'utf8');

test('gate 1.2 backup integrity is derived, not asserted', () => {
  assert.doesNotMatch(
    service,
    /integrity: 'verified',\n\s*passwordProtected/,
    "a literal 'verified' on every archive is the bug, not the fix",
  );
  assert.match(
    service,
    /const integrity: BackupIntegrity = satisfied \? 'verified' : 'incomplete'/,
    'integrity must be the answer to "does this archive contain what its type promises"',
  );
  assert.match(service, /wantsDatabase/, 'the check must know what the type is supposed to contain');
  // The check must remain *computed*. It used to be pinned to the v2 expression exactly,
  // which is what B15-2 had to widen: a v3 archive carries its dump as an encrypted
  // member and has no `dbBase64` at all, so the v2-only form would report every v3
  // archive as `incomplete` — a valid backup wearing the badge that means "written, but
  // not the thing it claims to be". The invariant is that both shapes are consulted, so
  // deleting the check cannot satisfy this.
  assert.match(
    service,
    /hasDatabase = streamDatabase[\s\S]{0,120}dbBase64/,
    'hasDatabase must consider the streamed member as well as the v2 payload field',
  );
  assert.doesNotMatch(
    service,
    /const hasDatabase = true\b/,
    'hasDatabase must never be a constant; that is the defect this gate exists for',
  );

  // `incomplete` is the state the old code had no way to express: the file is
  // fine, it is just not the thing it claims to be.
  assert.match(service, /export type BackupIntegrity = 'verified' \| 'incomplete' \| 'failed'/);

  // A matching checksum is not a completeness result. toListItem used to relabel
  // any intact file as verified, which is how a database-free config archive kept
  // a green badge.
  const toList = service.slice(service.indexOf('private toListItem'));
  assert.match(toList.slice(0, 700), /entry\.complete === false/);
  assert.doesNotMatch(toList.slice(0, 700), /integrity: valid \? 'verified' : 'failed'/, );
});

test('gate 1.3 an inventory backup is a partial archive, and restores as one', () => {
  assert.match(
    service,
    /const tables = type === 'inventory' \? \[\.\.\.INVENTORY_TABLES\] : undefined/,
    'inventory must select tables, not take the full-dump branch',
  );
  assert.match(service, /export const INVENTORY_TABLES = \[/);

  // Identity tables must not be inside what a stock backup captures.
  const list = service.slice(service.indexOf('export const INVENTORY_TABLES'));
  const body = list.slice(0, list.indexOf('] as const;'));
  for (const forbidden of ['users', 'roles', 'audit_logs', 'orders', 'partners']) {
    assert.ok(
      !new RegExp(`'${forbidden}'`).test(body),
      `${forbidden} must not be inside an inventory backup: restoring stock would restore it`,
    );
  }

  // `--clean` drops and recreates the schema. It is correct for a full dump and
  // destructive for a subset, which is how a stock restore took identity with it.
  assert.match(
    pgDump,
    /if \(options\.clean !== false && !options\.tables\?\.length\) args\.push\('--clean'/,
    'a partial restore must never pass --clean',
  );
  assert.match(pgDump, /for \(const table of options\.tables \?\? \[\]\) args\.push\(`--table=\$\{table\}`\)/);
  assert.match(service, /restoreDatabaseFromBase64\(payload\.dbBase64, payload\.partialTables\)/);
  assert.match(service, /partialTables\?: readonly string\[\] \| null/, 'the manifest must carry it');
});

test('gate 1.4 the manifest is written atomically and never silently empties', () => {
  assert.match(
    service,
    /withManifestLock/,
    'two read-modify-write cycles overlapped and a listing erased a backup it never saw',
  );
  assert.match(
    service,
    /writeFile\(temp,[\s\S]{0,200}rename\(temp, this\.manifestFile\)/,
    'write through a temp file and rename: a truncated index made every backup vanish',
  );
  // Corruption is a refusal now, and the damaged file is kept.
  assert.doesNotMatch(service, /JSON\.parse\(raw\)[\s\S]{0,120}catch \{\s*return \[\];/, );
  assert.match(service, /manifest is unreadable/);
  assert.match(service, /rename\(this\.manifestFile, quarantine\)/);
});

test('gate 1.5 restores are serialised', () => {
  assert.match(service, /private restoreInFlight = false/);
  assert.match(
    service,
    /if \(this\.restoreInFlight\)[\s\S]{0,200}Another restore is already running/,
    'two concurrent restores each disconnected the pool and replayed onto a half-rebuilt schema',
  );
  // The flag must be released on the failure path too, or one error wedges the
  // feature permanently. Sliced to the end of the method rather than a fixed
  // character budget: a budget silently stops covering the `finally` the moment a
  // comment is added above it, which is how a real guard decays into a passing one.
  const body = service.slice(service.indexOf('private async restoreDatabaseFromBase64'));
  const end = body.search(/\n {2}(?:async |private |public )/);
  const methodBody = body.slice(0, end > 0 ? end : 4000);
  assert.match(methodBody, /finally \{[\s\S]{0,200}this\.restoreInFlight = false/);
});

test('gate 1.6 the restore preview takes a safety snapshot, and it must be restorable', () => {
  // This test used to forbid the snapshot outright, and the reason was sound: the
  // preview called `createBackupInternal` with type `safety_snapshot`, which runs
  // `pg_dump --serializable-deferrable`. That takes a table-level lock conflicting
  // with every write in the application, with no `lock_timeout`, so one click froze
  // the write path process-wide for the length of the dump — and it wrote ~1.37x the
  // database per click against retention keyed on age alone.
  //
  // The diagnosis was right and the conclusion was wrong. It concluded the operator
  // does not need a snapshot; the operator needs one *enormously*. `safetySnapshotId`
  // was set to `null` and nothing else filled it, so `applyRestore` ran
  // `pg_restore --clean` against the only copy of the data while the interface
  // announced «تم إنشاء لقطة أمان مؤقتة`. A preview with no snapshot is not a
  // performant preview — it is a confirmation screen for an action with no undo,
  // shown immediately before the action.
  //
  // So the requirement is not "no dump in the preview" but "the snapshot in the
  // preview must be a real, verified, restorable safety net". That is what is
  // asserted here, and what `ops-003-restore-safety.spec.ts` proves end to end.
  const preview = service.slice(service.indexOf('async createRestorePreview'));
  const end = preview.indexOf('\n  async ');
  const body = preview.slice(0, end > 0 ? end : 2600);

  assert.match(
    body,
    /await this\.createBackupInternal\(\{\s*type: 'safety_snapshot'/,
    'the preview must take a safety snapshot. Without it a restore is irreversible, and the ' +
      'interface used to announce a snapshot that was never taken.',
  );

  // An archive with no database in it, or one whose integrity does not hold, is not a
  // safety net. The reset path already refuses on exactly this condition; the restore
  // path now does too, for the same reason.
  assert.match(
    body,
    /integrity === 'verified' && snapshot\.complete !== false|restorable/,
    'the snapshot must be checked for integrity before it is offered as an undo',
  );

  // And a snapshot that could not be taken must stop the restore, not be reported
  // as a successful preview with a null id.
  assert.match(
    body,
    /RESTORE_SAFETY_SNAPSHOT_FAILED/,
    'a failed safety snapshot must refuse the restore outright',
  );
  assert.doesNotMatch(
    body,
    /safetySnapshotId: null/,
    'the preview must never issue a token for a restore that has no safety snapshot',
  );

  // The cost concern from the original gate is still real. What it needs is not "no
  // snapshot" but "at most one per restore", which is a different claim and survives
  // the reversal: two previews for the same backup must not leave two snapshots
  // behind, or the write-path lock the original gate was protecting against returns
  // by a different route.
  const snapshotCalls = body.match(/type: 'safety_snapshot'/g) || [];
  assert.equal(
    snapshotCalls.length,
    1,
    'the preview must take exactly one safety snapshot. Zero leaves an irreversible restore; ' +
      'more than one re-introduces the repeated write-path lock gate 1.6 was written to prevent.',
  );

  assert.match(body, /blastRadius: this\.describeRestoreBlastRadius\(target\)/);
  assert.match(service, /replacesIdentity: true[\s\S]{0,80}note:/, 'a full restore must say it replaces identity');
});

test('gate 1.6b a restore confirmation without a snapshot is refused at the point of destruction', () => {
  // The second line of defence, and the one that matters most. The preview always
  // issues a snapshot now, so this is not the primary check — but a token is data,
  // and a caller can send one it did not receive from a preview: a replayed body, a
  // hand-written request, or a token minted before this change and still inside its
  // TTL. The blast radius of being wrong at this point is the whole database, so the
  // check belongs where the destruction happens, not only where the token is issued.
  const apply = service.slice(service.indexOf('async applyRestore'));
  const end = apply.indexOf('\n  private ');
  const body = apply.slice(0, end > 0 ? end : 1800);

  assert.match(
    body,
    /if \(!token\.safetySnapshotId\)[\s\S]{0,200}RESTORE_NO_SAFETY_SNAPSHOT/,
    'applyRestore must refuse a confirmation whose token carries no safety snapshot',
  );
  // And the refusal must come before the destructive call, not after it.
  const refuseAt = body.indexOf('RESTORE_NO_SAFETY_SNAPSHOT');
  const destroyAt = body.indexOf('restoreDatabaseFromBase64');
  assert.ok(
    refuseAt > -1 && destroyAt > refuseAt,
    'the refusal must precede the destructive restore. A check placed after it is a comment.',
  );
});

test('gate 2 deleting a backup is locked, bounded, and honest about failure', () => {
  // The behaviour itself is proved against real files in
  // `backend/src/backup/backup-delete-safety.test.ts`. What is guarded here are the
  // two structural facts that a behavioural test cannot see, and that a future edit
  // could quietly undo.
  const del = service.slice(service.indexOf('async deleteBackup'));
  const body = del.slice(0, del.indexOf('\n  /**') > 0 ? del.indexOf('\n  /**') : 2600);

  assert.match(
    body,
    /withManifestLock/,
    'deleteBackup used to read, write and unlink with no lock at all, so a backup created ' +
      'in that window lost its row and became an orphan file nothing could reach.',
  );
  assert.match(
    body,
    /assertDeletable/,
    'deleting the last copy must be refused: findBackupById then returns null for every id ' +
      'and monitoring answers SYSTEM_RESET_BACKUP_MISSING, so a reset refuses.',
  );
  assert.match(service, /BACKUP_LAST_COPY/, 'the refusal needs a code the UI and logs can key on');
  assert.match(
    service,
    /BACKUP_PINNED_BY_RESTORE/,
    'a safety snapshot an unconfirmed restore depends on must not be deletable. ' +
      'applyRestore checks the token names a snapshot, never that the archive still exists.',
  );

  // The failure that produced a lying response: the unlink error was swallowed, so a
  // row was dropped and a file left behind while the API answered `{deleted: true}`.
  assert.doesNotMatch(
    body,
    /unlink\([^)]*\)\.catch\(\(\) => undefined\)/,
    'swallowing the unlink error is what let a failed delete report success',
  );
  assert.match(
    body,
    /BACKUP_DELETE_FAILED/,
    'a file that could not be removed must be reported, and its row put back',
  );

  // The controller flattened every failure into a 500, so the refusals above would
  // have reached the operator as "Failed to delete backup" — the distinction is the
  // entire point of refusing.
  const controller = readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8');
  const route = controller.slice(controller.indexOf("async deleteBackup"));
  assert.match(
    route.slice(0, 700),
    /getErrorStatus\(error, HttpStatus\.INTERNAL_SERVER_ERROR\)/,
    'the delete route must pass the service status through instead of hardcoding 500',
  );

  // Every read-modify-write of the manifest shares one lock. `updateSchedule` used
  // to prune outside it, which erased the row of a backup created moments earlier.
  //
  // Sliced to the next method rather than a fixed window: `updateSchedule` is long,
  // and a character budget would either miss its lock call or let a match leak in
  // from the method after it — which is the same class of bug this file exists to
  // catch.
  const methodBody = (needle) => {
    const start = service.indexOf(needle);
    assert.ok(start > -1, `${needle} must still exist`);
    const rest = service.slice(start + needle.length);
    const end = rest.search(/\n {2}(?:async |private |public )/);
    return end > 0 ? rest.slice(0, end) : rest;
  };

  for (const name of ['async deleteBackup', 'async purgeOldBackups', 'async updateSchedule']) {
    assert.match(methodBody(name), /withManifestLock/, `${name} must take the manifest lock`);
  }
});

test('gate 3 the scheduler and a restore exclude each other', () => {
  // A restore drops and recreates tables. A scheduled backup running into that
  // dumps a half-rebuilt schema and archives it with a checksum and a green
  // integrity badge — a "verified" copy of a database that never existed in that
  // state, which is worse than no backup because it is indistinguishable from a
  // good one.
  const tick = service.slice(service.indexOf('private async schedulerTick'));
  const tickBody = tick.slice(0, tick.search(/\n {2}(?:async |private |public )/));
  assert.match(
    tickBody,
    /if \(this\.restoreInFlight\)[\s\S]{0,400}return/,
    'a due schedule must be skipped while a restore holds the database',
  );
  // The check has to come before the dump, not after it.
  assert.ok(
    tickBody.indexOf('restoreInFlight') < tickBody.indexOf('createBackupInternal'),
    'the exclusion must precede the dump',
  );

  // And the refusal is mutual. A restore started underneath a running dump would
  // hold the same table locks from the other side, so the restore is the one that
  // has to yield — it is retriable, and it is told why.
  const restore = service.slice(service.indexOf('private async restoreDatabaseFromBase64'));
  const restoreBody = restore.slice(0, restore.search(/\n {2}(?:async |private |public )/));
  assert.match(
    restoreBody,
    /if \(this\.schedulerRunning\)/,
    'a restore must refuse to start while the scheduler is dumping',
  );
  assert.ok(
    restoreBody.indexOf('schedulerRunning') < restoreBody.indexOf('restorePostgres'),
    'the refusal must precede the destructive restore',
  );
  // Setting the flag after the checks is what makes the exclusion mutual rather
  // than one-directional.
  assert.ok(
    restoreBody.indexOf('this.restoreInFlight = true') > restoreBody.indexOf('schedulerRunning'),
    'the restore flag must be claimed only after both exclusions have been checked',
  );
});

test('gate 4 the backup section leaves an audit trail, and the failure is a logged one', () => {
  // The behaviour is proved with a fake audit service in
  // `backend/src/backup/backup-audit.test.ts`. What is guarded here are the three
  // things that test cannot see, and that a later edit could undo quietly.
  const REQUIRED = [
    'BACKUP_CREATED',
    'BACKUP_DELETED',
    'BACKUP_DOWNLOADED',
    'RESTORE_PREVIEW',
    'RESTORE_APPLIED',
    'RESTORE_FAILED',
    'SCHEDULE_CHANGED',
  ];
  for (const action of REQUIRED) {
    assert.ok(
      service.includes(`recordBackupAudit('${action}'`),
      `${action} must be recorded. Before this the section wrote no rows at all, so a restore ` +
        'of the whole database and a deletion of the only copy both left no trace.',
    );
  }

  // "After the outcome, never before". A row written ahead of a restore describes a
  // restore that may have died halfway, and the RESTORE_FAILED row then contradicts
  // it — the trail becomes evidence of two things at once.
  const applied = service.indexOf("recordBackupAudit('RESTORE_APPLIED'");
  const destructive = service.indexOf('restoreDatabaseFromBase64');
  assert.ok(
    applied > -1 && destructive > -1 && applied > destructive,
    'RESTORE_APPLIED must be written after the restore ran, not before it',
  );
  const deleted = service.indexOf("recordBackupAudit('BACKUP_DELETED'");
  const unlink = service.indexOf('await fsPromises.unlink(path.join(this.backupDir, removed.fileName))');
  assert.ok(
    deleted > -1 && unlink > -1 && deleted > unlink,
    'BACKUP_DELETED must be written after the file is actually gone',
  );

  // Never fatal. These are file operations, not database transactions, so the row
  // cannot share a `tx` with the change it describes. If the write fails and the
  // action is turned into a 500, the operator is left believing a backup still
  // exists — a worse outcome than the missing row.
  const helper = service.slice(service.indexOf('private async recordBackupAudit'));
  const helperEnd = helper.search(/\n {2}(?:async |private |public )/);
  const helperBody = helper.slice(0, helperEnd > 0 ? helperEnd : 2200);
  assert.match(
    helperBody,
    /catch \(error\)[\s\S]{0,400}this\.logger\.error/,
    'a failed audit write must be logged and swallowed, never propagated to the caller',
  );
  assert.doesNotMatch(
    helperBody,
    /throw error/,
    'recordBackupAudit must not rethrow: the action has already happened',
  );

  // And the module has to be able to reach the audit service at all. Declared in
  // the action union and used by nothing is exactly how this section had no trail.
  const module_ = readFileSync(join(repoRoot, 'backend/src/backup/backup.module.ts'), 'utf8');
  assert.match(module_, /AuditModule/, 'BackupModule must import AuditModule');
  const auditService = readFileSync(join(repoRoot, 'backend/src/audit/audit.service.ts'), 'utf8');
  for (const action of REQUIRED) {
    assert.ok(auditService.includes(`'${action}'`), `${action} must be a declared audit action`);
  }
});

test('gate 7 a schedule that cannot be read stops the backup, and is not replaced by a default', () => {
  // The window is the mechanism, so it is asserted directly. The corruption path is
  // proved against real files in `backend/src/backup/backup-schedule.test.ts`.
  const should = service.slice(service.indexOf('private shouldRunNow'));
  const shouldBody = should.slice(0, should.search(/\n {2}(?:async |private |public )/));

  assert.doesNotMatch(
    shouldBody,
    /getMinutes\(\) !== schedule\.minute/,
    "requiring an exact minute gives the run one 30-second tick to land in. A tick delayed past " +
      'the boundary skips the day, and the next attempt is 24 hours away.',
  );
  assert.match(shouldBody, /getHours\(\) !== schedule\.hour/, 'the window is the hour');
  // `lastRunKey` is what makes a wider window safe, so its presence is not optional.
  assert.match(shouldBody, /schedule\.lastRunKey !== key/, 'a wider window must still run once a day');
  assert.match(shouldBody, /now\.getDay\(\) !== schedule\.dayOfWeek/, 'a weekly schedule stays weekly');
  assert.match(shouldBody, /now\.getDate\(\) !== target/, 'a monthly schedule stays monthly');

  // Corruption is a refusal, with the damaged file kept — the same contract the
  // manifest got in gate 1.4, for the same reason.
  const read = service.slice(service.indexOf('private async readSchedule'));
  const readBody = read.slice(0, read.search(/\n {2}(?:async |private |public )/));
  assert.doesNotMatch(
    readBody,
    /JSON\.parse\(raw\)[\s\S]{0,120}catch \{[\s\S]{0,80}return this\.defaultSchedule\(\)/,
    'a corrupt schedule reverting to defaults silently re-enables a schedule the operator turned ' +
      'off, shortens retention, and shows the operator settings they never chose',
  );
  assert.match(readBody, /BACKUP_SCHEDULE_CORRUPT/, 'the refusal needs a code');
  assert.match(readBody, /rename\(this\.scheduleFile, quarantine\)/, 'the damaged file is kept, not overwritten');
  assert.match(
    readBody,
    /error\?\.code === 'ENOENT'/,
    'an absent file is a first run and legitimately defaults; an unreadable existing one is not',
  );

  // And the write must stop producing the truncated file the reader now refuses.
  const write = service.slice(service.indexOf('private async writeSchedule'));
  const writeBody = write.slice(0, write.search(/\n {2}(?:async |private |public )/));
  assert.match(
    writeBody,
    /writeFile\(temp,[\s\S]{0,300}rename\(temp, this\.scheduleFile\)/,
    'a direct writeFile truncates first: a crash mid-write left a half-written schedule',
  );
});

test('gate 8 the two destructive actions have their own ceiling, and the PIN is compared in constant time', () => {
  const limiter = readFileSync(join(repoRoot, 'backend/src/security/global-rate-limit.ts'), 'utf8');

  // A restore and a delete are no longer one counter. They were: 5 per quarter hour
  // shared between overwriting the live database and deleting one archive out of fifteen,
  // so two restores exhausted the budget and any ordinary cleanup hit a ceiling designed
  // for data destruction. The symptom was `Too many requests` with no wait time, which
  // reads as a fault rather than a spent budget.
  assert.match(
    limiter,
    /case 'backup-restore':\s*return resolveDestructiveMax\(\);/,
    'restoring overwrites the live database, so it keeps the strict ceiling',
  );
  assert.match(
    limiter,
    /case 'backup-delete':\s*return resolveDeleteMax\(\);/,
    'deleting an archive must not spend the same budget as restoring',
  );
  assert.doesNotMatch(
    limiter,
    /case 'backup-destructive':/,
    'the shared bucket is the defect this split removed; do not merge them back',
  );
  assert.match(limiter, /return 5;|resolveDestructiveMax\(\)/, 'the strict ceiling must exist');
  assert.match(
    limiter,
    /=== 'POST'[\s\S]{0,120}\/backup\/restore/,
    'the restore flow is destructive at the preview too: it takes a full pg_dump of the live database',
  );
  assert.match(
    limiter,
    /method === 'DELETE' && \/\^\\\/backup\\\/\[\^\/\]\+\$\//,
    'DELETE /backup/:id is destructive and must not fall through to the fallback bucket',
  );
  // Per caller, not per office router — the same reasoning the fallback bucket was
  // given, and the reason a shared limit would be unusable for a quarterly action.
  assert.match(limiter, /trafficClass === 'backup-restore'/);

  // The PIN. `verifySecret` already used timingSafeEqual; the environment fallback
  // used `!==`, which returns on the first differing byte, so the time taken leaked
  // how much of a guess was right.
  const verify = service.slice(service.indexOf('private verifyRestorePinOrThrow'));
  const verifyBody = verify.slice(0, verify.search(/\n {2}(?:async |private |public )/));
  assert.doesNotMatch(
    verifyBody,
    /fallback !== pin|pin !== fallback/,
    'a plain string comparison on the restore PIN leaks the length of the correct prefix through timing',
  );
  assert.match(service, /private secretsMatch/, 'both PIN paths must go through one comparison');
  assert.match(service, /timingSafeEqual\(digest\(left\), digest\(right\)\)/, 'hash both sides to a fixed width first');

  // And failures have to cost something, or the PIN is only as strong as the patience
  // of whoever is guessing.
  assert.match(verifyBody, /assertPinNotLocked/, 'the lock is checked before the PIN is examined');
  assert.match(verifyBody, /recordPinFailure/, 'a wrong PIN must be counted');
  assert.match(verifyBody, /clearPinFailures/, 'a correct PIN must clear the count, or a careful operator locks themselves out');
  assert.match(
    verifyBody,
    /assertPinNotLocked[\s\S]{0,400}verifySecret|assertPinNotLocked[\s\S]{0,2000}secretsMatch/,
    'the lock must be consulted before the comparison, not after it',
  );
  assert.match(
    service,
    /PIN_LOCK_BASE_MS \* 2 \*\* \(over - 1\)/,
    'the penalty must grow, or a guesser simply waits out a flat fifteen minutes per attempt',
  );
  assert.match(service, /PIN_LOCK_MAX_MS/, 'and it must be capped, or the lock becomes permanent by arithmetic');
});

test('gate 21 there is a way back in', () => {
  // The failure this closes: downloading a backup and deleting it from the list was
  // a one-way street. The file went to the operator's disk and nothing in this
  // section would read it again — no upload route, no tool — so the only copy of the
  // database outside the system was unreachable, and the one operation that needed
  // it could not use it.
  //
  // The behaviour is proved in `backend/src/backup/backup-import.test.ts` against
  // real archives sealed with the service's own key. What is guarded here is the set
  // of doors, because a section can have a service method and no way to reach it,
  // which is the state this item was written in for its whole life.
  assert.match(
    readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8'),
    /@Post\('backup\/import'\)/,
    'there must be a route. A service method with no route is the exact state this item existed in.',
  );
  assert.match(service, /async importArchive\(/);
  assert.match(service, /BACKUP_IMPORTED/, 'provenance is its own action: nobody pressed a button for an import');

  // The identity of an archive comes from inside its authenticated envelope, never
  // from the upload. A filename is caller-controlled input and becomes a path.
  assert.match(service, /inspectEnvelope\(parsed\)/, 'the envelope shape is checked before any key derivation');
  const importBody = service.slice(service.indexOf('async importArchive'));
  const importEnd = importBody.search(/\n {2}(?:async |private |public )/);
  const body = importBody.slice(0, importEnd > 0 ? importEnd : 6000);
  assert.match(body, /decryptEnvelope\(envelope/, 'an archive sealed with another key must be refused, not stored');
  assert.match(body, /judgeImport\(\{/, 'id, type and date are judged from the authenticated payload');
  assert.match(body, /BACKUP_ALREADY_PRESENT/, 'importing the same archive twice must not create a second row');
  assert.doesNotMatch(
    body,
    /params\.originalName\.(replace|slice|substring)/,
    "the uploaded name must never be used to build the stored name — it is a path, and a path is not an identity",
  );
  assert.match(
    body,
    /fsPromises\.rename\(params\.filePath, destination\)/,
    'the file is only moved into place after every check has passed',
  );

  // Storing an archive the policy would immediately delete is allowed — the operator
  // asked for their own policy — but it must be said out loud, or an import that
  // vanishes on the next backup is indistinguishable from one that failed.
  assert.match(body, /plan\.refused\.includes\(entry\.id\)/, 'the at-risk case is computed, not assumed');
  assert.match(body, /atRiskOfImmediatePrune/);

  // A refusal must not leave the file behind. A folder of half-imported archives is
  // indistinguishable from a store that works.
  const controller = readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8');
  const route = controller.slice(controller.indexOf("async importBackup"));
  assert.match(
    route.slice(0, 2000),
    /unlink\(file\.path\)/,
    'a rejected upload must not accumulate in incoming/',
  );

  // B21, the second half. The client sends `Content-Type: application/json` on every
  // request, and a multipart body labelled as JSON arrives with no boundary: multer
  // parses zero files and the handler answers "no file was attached". The server was
  // proved working by a spec that posted through bare `fetch`; the button was broken,
  // and the difference was a header in a client nobody had exercised.
  //
  // So this is guarded on the client, not only on the route — a route that is proved
  // to work by a test using a different client is a route nobody has proved.
  const client = readFileSync(join(repoRoot, 'frontend/src/api/client.ts'), 'utf8');
  assert.match(
    client,
    /isMultipart[\s\S]{0,400}delete headers\['Content-Type'\]/,
    'a FormData body must not carry an explicit Content-Type, or the multipart boundary is lost ' +
      'and the server sees no file at all',
  );
  assert.match(
    readFileSync(join(repoRoot, 'tests/e2e/ops-005-backup-import-client.spec.ts'), 'utf8'),
    /apiClient\.post\('\/backup\/import'/,
    'there must be a spec that posts through apiClient. A spec that posts through fetch proves the ' +
      'server accepts an upload and says nothing about the button.',
  );

  // The permission exists on both sides, or the route is either unreachable or open.
  const catalog = readFileSync(join(repoRoot, 'backend/src/auth/permission-catalog.ts'), 'utf8');
  const clientCatalog = readFileSync(join(repoRoot, 'frontend/src/services/permissionsCatalog.ts'), 'utf8');
  for (const [name, source] of [['server', catalog], ['client', clientCatalog]]) {
    assert.ok(source.includes("'backup.import'"), `backup.import must exist in the ${name} catalog`);
  }

  // A 512 MB dump arrives as a ~680 MB file. The `20m` ceiling the proxies declare
  // for everything else would refuse it, and nginx answers 413 with an HTML page the
  // interface renders into a toast — the operator is holding the only copy of their
  // data and is told nothing useful.
  for (const path of ['frontend/nginx.frontend.conf', 'nginx.prod.conf']) {
    const source = readFileSync(join(repoRoot, path), 'utf8');
    assert.match(
      source,
      /location = \/api\/backup\/import \{[\s\S]{0,600}client_max_body_size\s+768m/,
      `${path} caps uploads at 20m, which is right for everything else and means an operator cannot ` +
        're-import their own backup. The import needs its own location.',
    );
    assert.match(
      source,
      /location = \/api\/backup\/import \{[\s\S]{0,900}proxy_request_buffering off/,
      `${path} buffers the whole archive to its own disk before the backend sees it, so it exists twice.`,
    );
  }
});

test('gate 9 retention is bounded by more than age, and cannot empty the store', () => {
  // The rules themselves are proved in `backend/src/backup/retention.test.ts`, which
  // is the only test in the repository that checks what retention *does* — the
  // existing coverage asserted that `retentionDays: 14` came back out of the API,
  // which passes just as happily against an implementation that deletes nothing.
  //
  // What is guarded here is that the service still delegates to that module, and the
  // two failure modes a pure-function test cannot reach.
  assert.match(
    service,
    /from '\.\/retention'/,
    'the retention policy needs one name. A rule re-implemented inline in the service is a rule ' +
      'that drifts from the one the tests cover.',
  );
  assert.match(service, /planRetention\(entries, limits/, 'applyRetention must delegate to planRetention');
  assert.doesNotMatch(
    service,
    /const ttlMs = Math\.max\(1, retentionDays\)/,
    'deleting by age alone cannot bound a store written more often than the retention window, and ' +
      'it put a restore undo on the same 30-day clock as everything else.',
  );

  // A row whose file could not be unlinked must be kept. Dropping it anyway — which
  // is what the swallowed `.catch()` did — produces a `.ffbkp` that nothing tracks:
  // invisible to the list, absent from the total, never pruned, unaddressable by id.
  const apply = service.slice(service.indexOf('private async applyRetention'));
  const applyBody = apply.slice(0, apply.search(/\n {2}(?:async |private |public )/));
  assert.doesNotMatch(
    applyBody,
    /unlink\([^)]*\)\.catch\(\(\) => undefined\)/,
    'a failed unlink must not drop the row — that is how an orphan file is manufactured',
  );
  assert.match(applyBody, /retained\.push\(entry\)/, 'a file that could not be removed keeps its row');
  assert.match(applyBody, /pinnedSnapshotIds: this\.pinnedSafetySnapshotIds\(\)/);

  // The floor. An empty manifest makes findBackupById return null for every id, which
  // makes the factory reset refuse — so a retention pass must never be the thing that
  // empties the store.
  assert.match(service, /minCount: number/, 'the schedule needs a floor');
  const retention = readFileSync(join(repoRoot, 'backend/src/backup/retention.ts'), 'utf8');
  assert.match(
    retention,
    /limits\.minCount = Math\.min\(limits\.minCount, limits\.maxCount\)/,
    'a floor above the ceiling protects everything and silently stops retention',
  );
  assert.match(retention, /PROTECTED_BACKUP_TYPES/);
  assert.match(
    retention,
    /allowance = Math\.max\(0, ordered\.length - limits\.minCount\)/,
    'the allowance is total minus the floor. Subtracting the already-marked rows as well counts them ' +
      'twice and refuses deletions the floor permits, which reads as retention doing nothing.',
  );
  assert.match(service, /RETENTION_BELOW_MINIMUM/, 'reaching the floor must be a refusal, not a warning');
  assert.match(
    service,
    /maxSafetySnapshots/,
    'each restore preview writes a whole database dump, so protecting snapshots needs a ceiling too',
  );

  // Every read-modify-write stays under the lock, including the new schedule
  // rejection, which must be decided *before* the schedule is written.
  //
  // Sliced to the end of each method rather than a character budget: `createBackupInternal`
  // is long, and a budget that no longer reaches its lock call would report a green
  // guard over an unlocked write.
  const bodyOf = (needle) => {
    const start = service.indexOf(needle);
    assert.ok(start > -1, `${needle} must still exist`);
    const rest = service.slice(start + needle.length);
    const end = rest.search(/\n {2}(?:async |private |public )/);
    return rest.slice(0, end > 0 ? end : rest.length);
  };

  for (const name of ['private async createBackupInternal', 'async updateSchedule', 'async purgeOldBackups']) {
    assert.match(bodyOf(name), /withManifestLock/, `${name} must take the manifest lock`);
  }
  const updateBody = bodyOf('async updateSchedule');
  assert.ok(
    updateBody.indexOf('RETENTION_BELOW_MINIMUM') < updateBody.indexOf('await this.writeSchedule(next)'),
    'the floor refusal must come before the schedule is written, or the operator gets a 409 and a changed setting',
  );
});

test('gate 5/13 the section answers "can I lose everything and get it back", from one place', () => {
  // The three screens that could have answered it each invented their own version, or
  // showed nothing: the reset screen inferred health from one field of one manifest
  // row, the dashboard showed a byte total, and App showed nothing at all. Three
  // answers with no way to keep them in agreement — so the product could tell the
  // operator two different things about the same archive on two screens, and there is
  // no failure when that happens.
  const health = readFileSync(join(repoRoot, 'backend/src/backup/backup-health.ts'), 'utf8');
  const state = readFileSync(join(repoRoot, 'backend/src/backup/backup-state.service.ts'), 'utf8');
  const controller = readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8');
  const monitoring = readFileSync(join(repoRoot, 'backend/src/monitoring/monitoring.service.ts'), 'utf8');
  const app = readFileSync(join(repoRoot, 'frontend/src/App.tsx'), 'utf8');
  const panel = readFileSync(join(repoRoot, 'frontend/src/components/BackupCenter.tsx'), 'utf8');

  // Age, integrity and restorability are three different claims, and a schedule that
  // stopped running is invisible unless age is judged against the schedule in force.
  assert.match(health, /BACKUP_STALE/, 'a stopped schedule must be detectable');
  assert.match(health, /BACKUP_CORRUPT/, 'a failing disk must not read as fresh and healthy');
  assert.match(health, /BACKUP_NOT_RESTORABLE/, 'verified and unusable is a state the list showed as green');
  assert.match(health, /toleranceHours/, 'one fixed age threshold either misses a stopped weekly schedule or cries wolf every morning');
  assert.match(health, /BACKUP_321/, 'the 3-2-1 answer must exist, and must be counted honestly');

  assert.match(state, /evaluateBackupHealth/, 'the service gathers facts and delegates every decision');
  assert.match(controller, /Get\('backup\/health'\)/, 'there must be one endpoint that answers the question');
  assert.match(monitoring, /this\.backupState\.getHealth\(\)/, 'the reset screen reads the shared answer');
  assert.doesNotMatch(
    monitoring,
    /this\.backupService\.listBackups\(\)\.catch/,
    'the reset screen must not derive health from the manifest itself — that is how the two drifted apart',
  );
  assert.match(panel, /fetchBackupHealth/, 'the panel reads the same endpoint');
  assert.match(app, /fetchBackupHealth/, 'App reads the same endpoint — the one place an operator is guaranteed to look');

  // Unknown is not healthy. Every path that cannot answer must say so.
  assert.match(state, /BACKUP_HEALTH_UNREADABLE/);
  assert.match(panel, /healthUnknown/);
});

test('gate 6 integrity is cached, and a badge can be re-checked on demand', () => {
  // `verifyIntegrity` streams the whole file through SHA-256, and `listBackups` called
  // it per archive per call — so opening the screen with twelve archives read the whole
  // store, and the panel, the reset screen and the dashboard each asked separately.
  assert.match(service, /INTEGRITY_CACHE_TTL_MS/);
  assert.match(
    service,
    /verifyIntegrityCached\(entry, options\.verify === true\)/,
    'the cache must be bypassable. A green badge that can only be re-checked on a timer is a claim, ' +
      'and an operator auditing their backups must be able to turn it into a measurement.',
  );
  // Keyed on the content hash, which is what makes it safe rather than merely fast: a
  // changed file changes its checksum, so it cannot be answered from the old verdict.
  assert.match(
    service,
    /const key = `\$\{entry\.id\}:\$\{entry\.checksumSha256\}`/,
    'the key must include the checksum, or a replaced file keeps the old answer',
  );
  // A verdict for a file that no longer exists is never read again and nothing else
  // will ever clear it.
  assert.match(service, /integrityCache\.delete\(`\$\{removed\.id\}/, 'deleting an archive must drop its verdict');
  assert.match(service, /integrityCache\.delete\(`\$\{entry\.id\}/, 'retention must drop the verdicts it removes');

  assert.match(
    readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8'),
    /@Query\('verify'\)/,
    '?verify=1 must reach the service, or the operator cannot ask for a fresh reading',
  );
});
test('gate 11/12 an archive carries its own key scope, and a rotated secret is diagnosed', () => {
  // The KDF was `pbkdf2(password + ':' + masterSecret, salt)`. The master secret was
  // mixed into every archive's key, so rotating `BACKUP_ENCRYPTION_SECRET` — which any
  // competent operator does after a rebuild — made every existing archive
  // undecryptable. The data was intact and the backup system could not read it, and
  // reported «Invalid password or corrupted file», the same sentence it uses for a
  // wrong passphrase and for a damaged file.
  const key = readFileSync(join(repoRoot, 'backend/src/backup/archive-key.ts'), 'utf8');

  // The default must not move. Changing it would silently re-scope every future
  // archive and quietly weaken what protects the ones being written now.
  assert.match(service, /params\.keyScope === 'archive-only' \? 'archive-only' : 'both'/, 'the default must stay `both`');
  assert.match(service, /envelope\.keyScope \?\? 'both'/, 'an archive with no scope is `both` — the only reading that keeps it open');
  assert.match(
    key,
    /pbkdf2Sync\(`\$\{resolved\.secret\}:\$\{String\(input\.masterSecret \|\| ''\)\.trim\(\)\}`,[\s\S]{0,20}input\.salt/,
    'the `both` KDF input must be byte-identical to the historical one, or every archive on ' +
      'disk becomes unreadable — a data-loss event disguised as a refactor',
  );
  // And it must exist in exactly one place. A second copy of a KDF is a copy that
  // will drift, and the drift is silent until an archive stops opening.
  assert.doesNotMatch(
    service,
    /private deriveAesKey/,
    'the old inline KDF must be gone, not left alongside the module as a second source of truth',
  );
  assert.match(
    key,
    /pbkdf2Sync\(resolved\.secret, input\.salt/,
    '`archive-only` must feed the passphrase alone, which is the whole point of the scope',
  );

  // The scope is refused rather than quietly satisfied with the master secret, which
  // would produce a file the operator believes is portable and that stops opening the
  // day the server is rebuilt.
  assert.match(key, /RESTORE_PASSPHRASE_REQUIRED/);

  // B12 — the diagnosis. A fingerprint is a truncated labelled hash: it reveals
  // nothing that helps recover the secret, and it is what makes a rotated secret
  // distinguishable from a wrong passphrase.
  assert.match(service, /masterSecretFingerprint: masterSecretFingerprint\(this\.getMasterSecret\(\)\)/);
  assert.match(key, /ffbkp:v1:master-secret-fingerprint/);
  assert.match(key, /SECRET_ROTATED/);
  assert.match(service, /BACKUP_SECRET_ROTATED/, 'a rotated secret must be refused by name, not guessed at');
  assert.match(service, /getRestoreReadiness\(\)/, 'there must be a way to ask before needing it');
  assert.match(
    readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8'),
    /Get\('backup\/restore-readiness'\)/,
  );
});
test('gate 17c the body is invoked inside the chain, never hoisted out of it', () => {
  // `const body = fn()` starts every operation immediately; the chain then only awaits
  // results, which removes serialisation altogether. The signature on a live server was
  // `index.json` losing rows *and* gaining rows — a lost update in both directions — and
  // it was introduced while making the advisory lock optional.
  //
  // The check is positional, because that is the invariant: the call to `fn` must be
  // reachable only from inside a `.then(` on the chain.
  const start = service.indexOf('private withManifestLock<T>');
  assert.ok(start > 0, 'withManifestLock must exist');
  const end = service.indexOf('\n  private ', start + 10);
  // Strip `//` comments first: this method's own explanation names `const body = fn()` as
  // the bug, and a scan that reads the prose would flag the comment that documents it.
  const body = service
    .slice(start, end > 0 ? end : start + 2500)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  const chain = body.indexOf('this.manifestChain');
  const invoke = body.indexOf('fn()');
  assert.ok(chain > 0 && invoke > 0, 'the chain and the call to fn must both be present');
  assert.ok(
    invoke > chain,
    'fn() is being called before the chain is reached — that is eager invocation, and it is the bug',
  );
  // Nothing between the chain reference and the invocation may assign fn's result to a
  // variable outside a callback.
  assert.doesNotMatch(
    body,
    /const\s+\w+\s*(:[^=]+)?=\s*fn\(\)/,
    'hoisting fn() out of the chain removes serialisation without changing any single call site',
  );
});

// --- B16: a full disk must be a message, not a truncated file. --------------

test('gate 16a the archive is written atomically, never straight to its final path', () => {
  assert.match(
    service,
    /private async writeArchiveAtomically/,
    'the atomic write is what keeps a failed write from occupying the final name',
  );

  // Exactly once per archive. This line was duplicated in the source, and every backup
  // paid for it twice: the file was written twice, and `JSON.stringify(envelope)` ran
  // twice over a string 1.778x the dump, so the second call allocated a second full-size
  // copy of the largest object in the process. The result was the same file, because the
  // write is atomic — which is exactly why nothing reported it and why a presence
  // assertion cannot catch it.
  const writeCalls = service.match(/await this\.writeArchiveAtomically\(/g) || [];
  assert.equal(
    writeCalls.length,
    1,
    `the archive must be written once, and it is currently written ${writeCalls.length} times`,
  );
  // temp write, then rename. Without the rename the temp name is what a reader sees.
  assert.match(service, /writeFile\(temp, body, 'utf8'\)/);
  assert.match(service, /rename\(temp, filePath\)/);
  // And a short file that got renamed anyway is taken back off the path.
  assert.match(
    service,
    /if \(written !== bytes\)/,
    'a renamed-but-truncated archive has a name, and the name is a promise',
  );
  // The direct write is the bug. If this ever comes back, ENOSPC comes with it.
  assert.doesNotMatch(
    service,
    /writeFile\(filePath, JSON\.stringify\(envelope\)/,
    'writing the envelope straight to its final path is how a partial file ends up looking complete',
  );
});

test('gate 16b free space is checked before any bytes are written', () => {
  assert.match(service, /private async assertArchiveFits/);
  // The check must precede the write in createBackupInternal, not follow it.
  const check = service.indexOf('await this.assertArchiveFits(');
  const write = service.indexOf('await this.writeArchiveAtomically(');
  assert.ok(check > 0 && write > 0, 'both the check and the write must exist');
  assert.ok(
    check < write,
    'the refusal has to come before the write, or it is a message about a file already on disk',
  );
});

test('gate 16c the estimate accounts for base64 being applied twice', () => {
  // The dump is base64'd into the payload, and the payload is base64'd into the
  // envelope. A check that forgets the second layer passes and then fails with ENOSPC.
  assert.match(
    headroom,
    /export const ENCODED_COST = \(BASE64_COST \* BASE64_COST\)/,
    '1.78x, not 1.33x: the encoded dump is inside an encoded payload',
  );
  assert.match(headroom, /projectedFreeBytes/);
  // The floor is the part that protects the database from its own backup.
  assert.match(
    headroom,
    /projected < floor/,
    'a write that fits but leaves nothing is how a backup takes down the server it protects',
  );
});

// --- B10: the directory and the manifest must be able to disagree. ---------

test('gate 10a reconciliation exists and refuses the two states where deleting is wrong', () => {
  assert.match(reconcile, /export function planReconciliation/);
  // A lost index is not evidence that the files are orphans. Deleting them would turn an
  // index fault into an empty disk.
  assert.match(
    reconcile,
    /code: 'MANIFEST_SUSPECT'/,
    'an empty manifest with archives on disk is a lost index, not a pile of orphans',
  );
  // And a sweep that empties the directory converts an inconsistency into a disaster.
  assert.match(
    reconcile,
    /archivesAfter === 0/,
    'refuse to delete the last archive file on disk, whatever the manifest says',
  );
});

test('gate 10b a file in flight is never swept', () => {
  assert.match(
    reconcile,
    /age < TEMP_GRACE_MS/,
    'the import path writes into this same directory; deleting by age alone kills a write in progress',
  );
  assert.match(reconcile, /TEMP_GRACE_MS = 60 \* 60 \* 1000/);
  // Tracked files are never touched, whatever their age.
  assert.match(reconcile, /KEEP_TRACKED/);
});

test('gate 2c a missing file is a completed delete, not a reason to restore the row', () => {
  // The undo in `deleteBackup` restored the row whenever `unlink` threw — including
  // ENOENT, which means the file is *already gone*, i.e. the desired outcome. The result
  // was an index row pointing at nothing: reconciliation never touches tracked files, so
  // the phantom survived every sweep and could not be deleted again. Seen on a live
  // server as three such rows.
  assert.match(
    service,
    /alreadyGone = error\?\.code === 'ENOENT'/,
    'ENOENT must be recognised as the goal state, not as a failure to undo',
  );
  // And the undo must be gated on it, not merely computed.
  const branch = service.slice(service.indexOf('alreadyGone'), service.indexOf('alreadyGone') + 1200);
  assert.match(
    branch,
    /if \(!alreadyGone\)[\s\S]*writeManifest\(\[\.\.\.manifest, removed\]\)/,
    'the row may only be written back when the file genuinely survived',
  );
});

test('gate 10c reconciliation is wired to a caller, not just exported', () => {
  assert.match(
    service,
    /async reconcileArchiveDirectory/,
    'a pure module nothing calls is not a fix',
  );
  // And it runs where orphans are actually created. The *locked-internal* form is
  // required, not stylistic: `manifestChain` is not re-entrant, so the public method
  // would queue behind the lock its caller already holds and the whole module would
  // deadlock. That hung every backup for sixteen minutes before it was found.
  assert.match(
    service,
    /await this\.reconcileArchiveDirectoryLocked\(\)/,
    'reconciliation must run after a backup, not only on request',
  );
  assert.doesNotMatch(
    service.slice(service.indexOf('await this.writeManifest(retained);')),
    /await this\.reconcileArchiveDirectory\(/,
    'the locked-internal form must be used inside a locked section, or it deadlocks',
  );
});

// --- B17: the lock has to outlive the process. ------------------------------

test('gate 17 the manifest lock is held by the database, not only by a promise', () => {
  // Transaction-scoped, inside an interactive transaction.
  //
  // `pg_advisory_lock` is **session**-scoped, and Prisma pools connections: the statement
  // taking the lock and the one releasing it were not guaranteed to share a connection.
  // When they did not, the release was a no-op on the wrong session and the lock stayed
  // held for as long as that connection lived — after which every later delete, retention
  // pass and import timed out behind it and the module appeared to hang. That is why the
  // feature shipped disabled.
  assert.match(
    lock,
    /pg_try_advisory_xact_lock/,
    'the lock must be transaction-scoped, so the database releases it on commit or rollback',
  );
  assert.doesNotMatch(
    lock,
    /pg_advisory_lock\(/,
    'the session-scoped lock is what leaked; it must not come back',
  );
  assert.doesNotMatch(
    lock,
    /pg_advisory_unlock/,
    'there is no release to forget: the commit releases a transaction-scoped lock',
  );
  // Inside a transaction, so the lock and the work share a lifetime.
  assert.match(lock, /\$transaction\(/, 'the lock must be taken inside a transaction');
  assert.match(lock, /timeout: waitMs/, 'the transaction must be bounded');
  assert.match(service, /withManifestAdvisoryLock\(this\.prisma/);
});

test('gate 17b a degraded lock proceeds, but is named — and never runs the body twice', () => {
  assert.match(
    lock,
    /mode: 'in-memory-only'/,
    'refusing every backup because the lock is unreachable would disable backups during an outage',
  );
  assert.match(lock, /degradedReason/);

  // The bug this pins: one try around both the acquisition and the body meant a failed
  // operation was re-run as part of "degrading" — deleting twice, creating two archives.
  // The invariant is control flow, not text. A textual count of `await fn()` would be
  // satisfied by a single call that a loop can reach twice, and broken by three calls on
  // mutually exclusive paths - which is what this file has, and is correct.
  const fallback = lock.indexOf('LockBusyError');
  assert.ok(fallback > 0, 'the degraded branch must exist — a busy lock is not an error');
  // Between the degraded branch and the body's `try` block there must be a `return`,
  // so the two paths cannot both reach the operation. (`lastIndexOf` rather than a
  // forward search: a forward search finds the `await fn()` *inside* the fallback
  // itself, which proves nothing.)
  const bodyTry = lock.lastIndexOf('if (bodyFailed) {');
  assert.ok(bodyTry > fallback, 'the body must be wrapped after the degraded branch');
  assert.match(
    lock.slice(fallback, bodyTry),
    /\breturn\b/,
    'the degraded branch must return before the body block below it, so no path runs the operation twice',
  );

  // The behavioural half of this lives in manifest-lock.test.ts, where the body is
  // counted rather than the source inspected. This gate only has to keep the structure.
});
// --- Phase 0: a restore must be possible on a default deployment. -----------

test('gate P0a a restore with no PIN configured is not refused', () => {
  // This made every backup on a default server unrestorable. `verifyRestorePinOrThrow`
  // threw "Restore PIN is required" when the caller sent none, and "Restore PIN is not
  // configured" when none existed — so no restore was possible unless a PIN had been
  // set, and a default deployment has none. The interface then demanded a code the
  // operator had never been given, so there was nothing to type.
  const service_ = readFileSync(join(repoRoot, 'backend/src/backup/backup.service.ts'), 'utf8');
  const fn = service_.indexOf('private verifyRestorePinOrThrow');
  assert.ok(fn > 0, 'verifyRestorePinOrThrow must exist');
  const body = service_.slice(fn, fn + 3000);

  assert.match(
    body,
    /if \(!this\.restorePinIsConfigured\(schedule\)\) \{\s*return;/,
    'with no PIN configured there is nothing to demand, so the gate must open',
  );

  // The demand must come *after* the configured check, never before it.
  const configured = body.indexOf('restorePinIsConfigured');
  const demand = body.indexOf('Restore PIN is required');
  assert.ok(
    configured > 0 && demand > configured,
    'the demand for a PIN must be gated on one actually being configured',
  );
});

test('gate P0b the configured-check and the enforcement share one predicate', () => {
  // They were two independent `if`s, so the second could reach a branch the first had
  // already decided impossible. One predicate used by both is what makes them agree by
  // construction rather than by review.
  const service_ = readFileSync(join(repoRoot, 'backend/src/backup/backup.service.ts'), 'utf8');
  assert.match(
    service_,
    /private restorePinIsConfigured\(/,
    'a single predicate, so "is a PIN configured" cannot be asked two ways',
  );
  // And nothing may reintroduce the unconditional refusal at the top of the function.
  const fn = service_.indexOf('private verifyRestorePinOrThrow');
  const body = service_.slice(fn, fn + 600);
  assert.doesNotMatch(
    body,
    /const pin = String\(restorePin \|\| ''\)\.trim\(\);\s*if \(!pin\) throw/,
    'an unconditional empty-PIN refusal at the top is exactly the defect this gate exists to prevent',
  );
});

test('gate P0c the screen reads the protection state instead of asserting one', () => {
  // The server has sent `hasRestorePin` since B5 and the API type declared it, and
  // nothing read it — so the panel printed a fixed sentence claiming a PIN that a
  // default deployment does not have.
  const component = readFileSync(
    join(repoRoot, 'frontend/src/components/BackupCenter.tsx'),
    'utf8',
  );

  assert.match(
    component,
    /scheduleInfo\?\.hasRestorePin && !restorePin\.trim\(\)/,
    'the PIN may only be demanded when the server says one is configured',
  );
  assert.doesNotMatch(
    component,
    /if \(!restorePin\.trim\(\)\)/,
    'the unconditional refusal must be gone — it blocked every restore',
  );
  // The notice must describe the real state, including the unprotected case.
  assert.match(
    component,
    /scheduleInfo\?\.hasRestorePin\s*\?[\s\S]{0,200}?:\s*'لا يوجد رمز استعادة/,
    'the protection notice must say when there is no PIN, rather than claiming one always is',
  );
});
// --- Phase 1: one variable drove three unrelated things. -------------------

test('gate P1a the log filter cannot reach the create buttons', () => {
  // `activeType` chose which records the log showed, which kind of backup the primary
  // button created, and what that button was labelled. So picking a filter changed the
  // button — the operator reported that «إنشاء نسخة كاملة» turned into
  // «إنشاء نسخة المخزون» when they selected the inventory filter, which was already a
  // separate button. The full-backup button existed only while the filter said "full".
  const component = readFileSync(
    join(repoRoot, 'frontend/src/components/BackupCenter.tsx'),
    'utf8',
  );

  // Comments are stripped first: the explanations left behind name `activeType` on
  // purpose, and a scan that reads prose would flag the comment documenting the fix.
  const code = component
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  assert.doesNotMatch(
    code,
    /activeType/,
    'the shared variable is the defect; it must not come back',
  );
  assert.doesNotMatch(
    component,
    /createActionLabel/,
    'a create button whose label depends on the log filter is the reported bug',
  );

  // Three fixed buttons, each naming its own type.
  assert.match(component, /runBackup\('full'\)/, 'the full-backup button must exist unconditionally');
  assert.match(component, /runBackup\('inventory'\)/);
  assert.match(component, /runBackup\('config'\)/);
  assert.match(component, /'إنشاء نسخة كاملة'/);
});

test('gate P1b the filter lives with the list it filters, and shows its counts', () => {
  // It used to be its own card between the health panel and the settings, so the control
  // sat far from the log. And the default was `full`, which also showed
  // `safety_snapshot` and hid every config and inventory archive — so on a server holding
  // mostly config archives the log read as empty.
  const filter = readFileSync(
    join(repoRoot, 'frontend/src/components/backup-log-filter.ts'),
    'utf8',
  );

  assert.match(filter, /value: 'all', label: 'الكل'/, 'all must be the first option offered');
  assert.doesNotMatch(
    filter,
    /'full' \| 'safety_snapshot'/,
    '`full` must not imply safety snapshots; one filter changed the list without saying so',
  );
  assert.match(filter, /export function countArchives/);
  assert.match(filter, /export function countForFilter/);

  const component = readFileSync(
    join(repoRoot, 'frontend/src/components/BackupCenter.tsx'),
    'utf8',
  );
  assert.match(component, /BACKUP_FILTERS\.map/);
  assert.match(component, /archiveCounts\[filter\.value\]/, 'each filter must say what it would show');
  assert.match(
    component,
    /useState<BackupFilter>\('all'\)/,
    'the default must show every kind, not hide two of them',
  );
});

// --- Phase 2: no option that does nothing. ---------------------------------

test('gate P2 the storage targets are not offered, because nothing wrote to them', () => {
  // `local`, `usb` and `drive` were checkboxes the service saved, validated and echoed
  // back. Nothing ever wrote to a USB device or a network share: every archive went to one
  // directory on this machine. So the control was a claim about resilience the system did
  // not honour, one screen from a panel that honestly reports `offSiteCopies: 0`.
  const component = readFileSync(
    join(repoRoot, 'frontend/src/components/BackupCenter.tsx'),
    'utf8',
  );

  assert.doesNotMatch(
    component,
    /'usb', 'drive'/,
    'offering destinations that are never written to is the defect',
  );
  assert.doesNotMatch(component, /storageTargetLabel/, 'the labels were only for the removed options');
  assert.match(component, /ARCHIVE_STORAGE_TARGETS = \['local'\]/);
  // And the fact is now stated rather than implied.
  assert.match(
    component,
    /لا توجد نسخة خارج المضيف/,
    'the section must say there is no off-host copy, instead of implying one is configurable',
  );
});
// --- B19: an off-host copy that is measured, not asserted. ------------------

test('gate 19a the off-host copy is read back and hashed before it counts', () => {
  // `fs.copyFile` returning without error is not evidence the bytes arrived. A device
  // unplugged at the wrong moment produces a truncated file and a success code, and a
  // truncated second copy is the most dangerous outcome available: it looks like
  // protection, it is counted as protection, and it will not open when it is needed.
  const offsite = readFileSync(join(repoRoot, 'backend/src/backup/offsite-copy.ts'), 'utf8');

  assert.match(offsite, /hashFile\(target\)/, 'the destination must be read back and hashed');
  assert.match(
    offsite,
    /written !== expectedSha256/,
    'a file whose bytes differ is not a backup, whatever copyFile said',
  );
  assert.match(offsite, /unlink\(target\)/, 'the bad file must not be left with the right name');
  // And it must never throw into the backup path: a dead device must not mark a good
  // archive as failed.
  assert.doesNotMatch(offsite, /throw new [A-Za-z]*Error\(/);
});

test('gate 19b the health report counts verified copies, not a configured setting', () => {
  // A destination that is configured and a copy that arrived are different claims. Counting
  // the setting is how a USB device that was unplugged once reads as off-site coverage.
  const state = readFileSync(join(repoRoot, 'backend/src/backup/backup-state.service.ts'), 'utf8');
  assert.match(state, /countVerifiedOffsiteCopies\(/, 'the number must be measured from the copies');
  assert.doesNotMatch(
    state,
    /offSiteCopies: 0,/,
    'a hardcoded zero is honest only when nothing was ever configured; this one is now measured',
  );
});

test('gate 19c the off-host copy cannot be the archive it copies', () => {
  // A destination inside the backup directory satisfies every check and protects against
  // nothing — it is the first copy wearing a second copy''s name.
  const offsite = readFileSync(join(repoRoot, 'backend/src/backup/offsite-copy.ts'), 'utf8');
  assert.match(
    offsite,
    /normalisedDestination === sourceDirectory/,
    'the destination must be refused when it is the directory holding the archive',
  );
});