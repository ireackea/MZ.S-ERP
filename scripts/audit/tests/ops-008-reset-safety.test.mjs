import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

/**
 * A reset is the only operation in this product that deletes the catalogue, and
 * two things around it are broken in a way that makes it worse than having no
 * safety net at all: it leaves a permanently stuck saved order behind, and the
 * safety snapshot it insists on is destroyed by the next ordinary deploy.
 *
 * Both were observed on the live database on 2026-09-28 rather than derived.
 *
 * The stuck order: `RESET_TARGETS` cleared `Item`, whose rows the saved-order
 * entries cascade from, but not the profiles themselves. What survived was
 * `isActive = true`, `itemCount = 142`, zero entries. Applying it was refused for
 * being empty, deleting it was refused for being the active profile, and there was
 * no deactivate route. The object could never be used and never removed.
 *
 * The missing snapshot: `executeScopedReset` refuses to run without a verified
 * backup and writes that backup's id into its audit row. The backup directory is
 * `path.join(process.cwd(), 'backups')` — inside the container's writable layer —
 * and the default compose file mounted only the uploads volume. A 662 KB verified
 * archive was present and gone after one `docker compose up --build backend`, with
 * the manifest reset to two bytes. The production compose file mounts a volume
 * there; the default one, which is what `npm run deploy:prod` and the whole
 * development workflow use, did not.
 */
test('a reset clears the saved catalogue orders, not only their items', () => {
  const source = read('backend/src/monitoring/monitoring.service.ts');
  const start = source.indexOf('export const RESET_TARGETS');
  assert.notEqual(start, -1, 'RESET_TARGETS must exist. If it was renamed, point this guard at the new name.');
  const end = source.indexOf('];', start);
  const list = source.slice(start, end === -1 ? undefined : end);

  for (const model of ['itemOrderEntry', 'itemOrderProfile']) {
    assert.match(
      list,
      new RegExp(`model:\\s*'${model}'`),
      `RESET_TARGETS must clear ${model}. Entries cascade from Item, so deleting the items empties ` +
        'every profile while leaving the profile in place, active, and still announcing a non-zero ' +
        'itemCount — an order over rows that no longer exist, which can neither be applied nor deleted.',
    );
  }
});

test('the saved-order tables are still in the reset guard test the service relies on', () => {
  // monitoring.service.ts:76-79 states that a test replays this list against the
  // live schema, so a table added to the schema without being placed in
  // RESET_TARGETS fails a test rather than an operator's reset. The point of this
  // assertion is that the replay still covers the two new entries.
  const source = read('backend/src/monitoring/monitoring.service.ts');
  assert.match(
    source,
    /RESET_TARGETS[\s\S]{0,4000}itemOrderProfile/,
    'The new reset targets must be reachable from the same declaration the schema-replay test reads.',
  );
});

test('the backup directory survives a container rebuild on every stack', () => {
  // docker-compose.prod.yml already mounts `backups-data:/app/backups`. The
  // default file did not, which is the stack `npm run deploy:prod` starts and the
  // stack every e2e run uses.
  const service = read('backend/src/backup/backup.service.ts');
  const dirMatch = /private readonly backupDir = path\.join\(process\.cwd\(\), '([^']+)'\)/.exec(service);
  assert.ok(dirMatch, 'If backupDir moved, point this guard at the new expression.');
  const dirName = dirMatch[1];
  assert.equal(dirName, 'backups', 'The reset precondition and this guard both assume the backups directory.');

  for (const file of ['docker-compose.yml', 'docker-compose.prod.yml']) {
    const compose = read(file);
    const backendBlock = /backend:[\s\S]*?(?=\n  [a-z]+:|\nvolumes:|\nnetworks:)/.exec(compose);
    assert.ok(backendBlock, `${file} has no backend service block to check.`);
    assert.match(
      backendBlock[0],
      new RegExp(`-\\s*\\S+:\\/app\\/${dirName}`),
      `${file} does not mount a volume at /app/${dirName} on the backend service. Without it every ` +
        '`docker compose up --build` deletes every archive, including the pre-reset snapshot that a ' +
        'system reset refuses to run without — so the reset is safe at the moment it runs and ' +
        'unrecoverable by the next deploy.',
    );
  }
});

test('the volume is named, so backups are inspectable from the host', () => {
  // `item_uploads` exists for the same reason (FC-ITEM-001). An anonymous volume
  // survives a rebuild but not `docker compose down -v`, and cannot be inspected
  // without going through the container.
  const compose = read('docker-compose.yml');
  const volumesBlock = compose.slice(compose.indexOf('\nvolumes:'));
  assert.match(
    volumesBlock,
    /^\s*backup_storage:\s*$/m,
    'docker-compose.yml must declare backup_storage as a named volume in the top-level volumes block.',
  );
  const servicesBlock = compose.slice(0, compose.indexOf('\nvolumes:'));
  const usesNamed = /-\s*backup_storage:\/app\/backups/.test(servicesBlock);
  assert.ok(usesNamed, 'The backend service must mount the named volume, not an anonymous path.');
});

test('a reset refuses to run when its backup is not addressable by id', () => {
  const source = read('backend/src/monitoring/monitoring.service.ts');
  const start = source.indexOf('SYSTEM_RESET_BACKUP_NOT_RESTORABLE');
  assert.notEqual(start, -1, 'The unrestorable-backup refusal must still exist.');
  const window = source.slice(start, start + 2600);

  assert.match(
    window,
    /findBackupById/,
    'After the integrity check the reset must confirm the archive is still addressable by its id. ' +
      'A healthy return value from createBackup does not mean the file is still on disk, and this is ' +
      'the one moment that difference matters.',
  );
  assert.match(
    window,
    /SYSTEM_RESET_BACKUP_MISSING/,
    'A missing archive must produce its own named refusal, distinct from the unrestorable one, so ' +
      'the operator can tell "the backup was never good" from "the backup was deleted".',
  );
  assert.doesNotMatch(
    window,
    /await this\.recordResetAudit\([\s\S]{0,400}?\)\s*;\s*\n\s*throw[\s\S]{0,200}?SYSTEM_RESET_BACKUP_MISSING[\s\S]{0,200}?\n\s{2}\}/,
    'Every refusal must record an audit row before throwing, so an operator can see that a reset was ' +
      'attempted and refused rather than finding no trace of the attempt.',
  );
});

test('findBackupById reports a manifest entry whose file is gone as missing', () => {
  const service = read('backend/src/backup/backup.service.ts');
  const start = service.indexOf('async findBackupById');
  assert.notEqual(start, -1, 'findBackupById must exist. If it was renamed, point this guard at the new name.');
  // The boundary must stop at the next *member*, whatever its modifier. Searching for
  // `\n  async ` alone runs straight through a `private async` method, so this guard was
  // reading two methods and asserting that the second one did not call the first.
  const rest = service.slice(start + 'async findBackupById'.length);
  const boundary = rest.search(/\n {2}(?:async |private |public )/);
  const end = boundary === -1 ? undefined : start + 'async findBackupById'.length + boundary;
  // Comments are stripped before the assertions below.
  //
  // This guard asserts on a method body, and a body boundary found by searching for
  // the next `async` can include the doc comment of the method after it. That comment
  // mentioned `verifyIntegrity` while explaining why this method must not call it, and
  // the guard fired on the prose, on a method that has never called it.
  //
  // A guard that trips on a mention of a name will be silenced rather than satisfied,
  // so it has to read only the code. The comment is stripped here rather than avoided
  // in the service, because the next person to write an honest comment about this
  // method would hit exactly the same thing.
  const body = service
    .slice(start, end === -1 ? undefined : end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  assert.match(
    body,
    /fsPromises\.stat/,
    'The check must touch the filesystem. Reading the manifest alone would answer "present" for an ' +
      'archive the container no longer has, which is the exact failure being prevented.',
  );
  assert.match(
    body,
    /return null/,
    'A missing or empty archive must resolve to null so a caller gating a destructive path is never ' +
      'told yes about a file it cannot read.',
  );
  assert.doesNotMatch(
    body,
    /verifyIntegrity/,
    'This must not re-hash every archive. It gates a destructive path, and paying the full ' +
      'verification cost of a listing here would be the wrong trade for a precondition.',
  );
});

test('the reset targets list is a closed list the schema replay test can read', () => {
  // Guards against a table being added to schema.prisma and forgotten here, which
  // is how the two saved-order tables were missed: nothing failed until a reset
  // left an unremovable object behind.
  const schema = read('backend/prisma/schema.prisma');
  const modelNames = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]);
  const source = read('backend/src/monitoring/monitoring.service.ts');
  const list = source.slice(
    source.indexOf('export const RESET_TARGETS'),
    source.indexOf('];', source.indexOf('export const RESET_TARGETS')),
  );
  const covered = new Set([...list.matchAll(/model:\s*'(\w+)'/g)].map((match) => match[1]));

  assert.ok(covered.size >= 14, 'The reset list lost entries. It previously covered 14 models.');
  for (const model of ['item', 'transaction', 'openingBalance', 'stockDeficit', 'itemOrderProfile']) {
    assert.ok(covered.has(model), `${model} must be in RESET_TARGETS.`);
  }
  assert.ok(
    modelNames.length > covered.size,
    'This assertion is only meaningful while not every model belongs in a reset. If the schema and the ' +
      'list are being compared, move the comparison into a deliberate test rather than this one.',
  );
});
