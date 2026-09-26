// FC-OPS-001 — Complete full backup and restore.
// Fails if a backup can silently omit data, if the runtime cannot actually dump
// PostgreSQL, or if a restore can proceed without verifying the dump first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const service = read('backend/src/backup/backup.service.ts');
const pgDump = read('backend/src/backup/pg-dump.ts');
const dockerfile = read('backend/Dockerfile');

test('the runtime image can actually dump PostgreSQL', () => {
  // Without the client tools a "full" backup copies nothing.
  assert.match(dockerfile, /postgresql-client-16/,
    'the image must ship the PostgreSQL client tools');
  // pg_dump refuses to run against a newer server, so the major version is
  // pinned rather than left to the Debian default.
  assert.match(dockerfile, /apt\.postgresql\.org/,
    'the client must come from PGDG so its major version matches the server');
  assert.match(service, /dumpPostgres\(/);
  assert.match(service, /isPostgresUrl\(databaseUrl\)/);
});

test('the dead SQLite path is gone', () => {
  assert.ok(
    !/resolveSqliteDbPath/.test(stripComments(service)),
    'the SQLite path cannot resolve on PostgreSQL and must not remain',
  );
  assert.ok(
    !/dev\.db|file:\.\//.test(stripComments(service)),
    'a SQLite fallback would silently produce a partial backup',
  );
  assert.ok(!/\bcopyFile\(tempPath, dbPath\)/.test(service), 'the SQLite restore path must be gone');
});

test('a backup carries a manifest with completeness and checksums', () => {
  assert.match(service, /type BackupManifest = \{/);
  assert.match(service, /expectedModels: string\[\]/);
  assert.match(service, /includedModels: string\[\]/);
  assert.match(service, /missingModels: string\[\]/);
  assert.match(service, /checksums: Record<string, string>/);
  assert.match(service, /schemaVersion/);
  assert.match(service, /appVersion/);
  assert.match(service, /modelCounts: Record<string, number>/);
  assert.match(service, /buildManifest/);
});

test('a restore refuses an incomplete or corrupt backup before it is destructive', () => {
  assert.match(service, /assertManifestIsRestorable/);
  assert.match(service, /assertManifestChecksums/);

  // The completeness gate must run before the restore step, not after.
  const restoreFlow = service.slice(service.indexOf('const payload = this.decryptEnvelope'));
  const gateIndex = restoreFlow.indexOf('assertManifestIsRestorable');
  const restoreIndex = restoreFlow.indexOf('restoreDatabaseFromBase64');
  assert.ok(gateIndex > -1, 'the completeness gate is missing');
  assert.ok(restoreIndex > -1, 'the restore step is missing');
  assert.ok(gateIndex < restoreIndex, 'verification must run BEFORE the destructive restore');

  assert.match(service, /is incomplete\. Missing tables/);
  assert.match(service, /checksum mismatch/);
  assert.match(service, /refusing to restore an unverifiable dump/);
});

test('excluded tables are stated, not silently dropped', () => {
  assert.match(service, /excludedModels/);
  // Session and replay state are excluded on purpose, with a reason.
  assert.match(service, /ActiveSession/);
  assert.match(service, /IdempotencyRecord/);
  assert.match(service, /reason: 'Session tokens are intentionally not restored/);
});

test('attachments are declared as out of the database dump, with a reason', () => {
  assert.match(service, /attachments: \{ included: boolean; fileCount: number; reason: string \}/);
  const attachments = service.slice(service.indexOf('attachments: {'));
  assert.match(attachments, /included: false/);
  assert.match(attachments, /reason: 'Item attachments are stored on a filesystem volume/,
    'the exclusion must be explained, not implied');
});

test('per-backup completeness is recorded so the UI can show it', () => {
  assert.match(service, /databaseBytes\?: number/);
  assert.match(service, /complete\?: boolean/);
  assert.match(service, /missingModels\?: string\[\]/);
  // getStorageStats must not report a database size read from a file that
  // does not exist on this deployment.
  assert.ok(!/fsPromises\.stat\(dbPath\)/.test(service));
  assert.match(service, /latestDatabaseBytes/);
});

test('destructive restore controls remain in place', () => {
  // Safety snapshot, preview token, and PIN must all still gate a restore.
  assert.match(service, /safety_snapshot/);
  assert.match(service, /issueRestoreToken|restoreTokens\.set/);
  assert.match(service, /consumeRestoreToken/);
  assert.match(service, /verifyRestorePinOrThrow/);
  assert.match(service, /verifyIntegrity/);
  // The pool is released so the restore is not fighting live connections.
  assert.match(service, /\$disconnect\(\)/);
});

test('the dump never exposes the password on the command line', () => {
  assert.match(pgDump, /PGPASSWORD: parsed\.password/);
  assert.ok(!/args\.push\(\s*['"`][^'"`]*password/i.test(pgDump));
  assert.match(pgDump, /--no-password/);
  // A dump is a consistent snapshot, not a series of independent reads.
  assert.match(pgDump, /--serializable-deferrable/);
  assert.match(pgDump, /--format=custom/);
});

test('a complete, checksummed backup is actually restorable', () => {
  // FC-QA-002 found this: the manifest gate used to throw whenever a dump
  // declared a checksum, which every real full backup does. The message even
  // said "must be performed by the caller", but no caller did it, so every HTTP
  // restore failed with 400 while the pg_restore path used by the E2E spec
  // passed. The checksum itself is verified in assertManifestChecksums, which
  // is the code that has the payload bytes.
  const gate = service.slice(
    service.indexOf('private assertManifestIsRestorable'),
    service.indexOf('private assertManifestChecksums'),
  );

  // The old bug was a *positive* `&& sha256` throw. Assert that exact shape is
  // gone, without forbidding the legitimate `&& !sha256` refusal.
  assert.doesNotMatch(
    gate,
    /databaseDump\.included && (?:manifest\.)?databaseDump\.sha256\s*\)/,
    'the presence of a checksum must not by itself block a restore',
  );
  assert.doesNotMatch(gate, /must be performed by the caller/);
  assert.match(gate, /databaseDump\.included && !manifest\.databaseDump\.sha256/,
    'a dump with no checksum is still refused');
  // The real verification must remain, and it must be the checksum comparison.
  assert.match(service, /assertManifestChecksums\(payload\)/);
  assert.match(service, /Database dump checksum mismatch/);
  assert.match(service, /createHash\('sha256'\)\.update\(payload\.dbBase64\)/);
});
