// Gate 1 — the backup surface reported success it had not earned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const service = readFileSync(join(repoRoot, 'backend/src/backup/backup.service.ts'), 'utf8');
const pgDump = readFileSync(join(repoRoot, 'backend/src/backup/pg-dump.ts'), 'utf8');

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
  assert.match(service, /hasDatabase = typeof payload\.dbBase64 === 'string'/);

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
  // feature permanently.
  const body = service.slice(service.indexOf('private async restoreDatabaseFromBase64'));
  assert.match(body.slice(0, 1400), /finally \{[\s\S]{0,120}this\.restoreInFlight = false/);
});

test('gate 1.6 the restore preview does not dump the database', () => {
  const preview = service.slice(service.indexOf('async createRestorePreview'));
  const end = preview.indexOf('\n  async ');
  const body = preview.slice(0, end > 0 ? end : 2000);

  assert.doesNotMatch(
    body,
    /await this\.createBackupInternal\(/,
    'the preview wrote a whole safety_snapshot per click: a write-path lock and ~1.37x the db each time',
  );
  assert.match(body, /blastRadius: this\.describeRestoreBlastRadius\(target\)/);
  assert.match(service, /replacesIdentity: true[\s\S]{0,80}note:/, 'a full restore must say it replaces identity');
});
