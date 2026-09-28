import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

/**
 * A test suite must not be able to destroy the database it is testing against.
 *
 * This exists because it already happened. `ops-001-backup.spec.ts` ran
 *
 *   pg_restore --clean --if-exists -d feed_factory_db
 *
 * `--clean` drops and recreates every object in the archive, so the suite that
 * exists to prove the backup is restorable emptied the live catalog: 648 items,
 * 1252 movements, 210 deficits, 42k audit rows. It reported success, because the
 * one marker row it asserted on came back. Recovery came from a backup taken
 * three hours earlier.
 *
 * The rule this encodes: a restore may only ever target a database the test
 * created for the purpose. `pg_restore`, `pg_dump` with a live target, and
 * `TRUNCATE` are fine in a throwaway; against the configured application
 * database they are not, whatever the test's name suggests it is proving.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const mentionsLiveDatabase = (code) =>
  code.includes('feed_factory_db') || code.includes('process.env.POSTGRES_DB');

const specFiles = () => {
  const dir = join(repoRoot, 'tests/e2e');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => ({ name, code: stripComments(readFileSync(join(dir, name), 'utf8')) }));
};

test('no e2e spec combines --clean with the application database', () => {
  // `--clean` tells pg_restore to drop every object in the archive before
  // recreating it. Against the live database that is not a test, it is a
  // deletion, and it is how 648 items and 1252 movements were emptied while the
  // suite reported success.
  const offences = [];

  for (const { name, code } of specFiles()) {
    if (!code.includes('--clean')) continue;
    if (!mentionsLiveDatabase(code)) continue;
    // Naming a scratch target on the same command is the escape hatch, and it
    // has to appear near the --clean, not somewhere else in the file.
    const cleanLines = code
      .split('\n')
      .filter((line) => line.includes('--clean'));
    for (const line of cleanLines) {
      if (/scratch|sandbox|_isolated/.test(line)) continue;
      offences.push(`${name}: ${line.trim().slice(0, 100)}`);
    }
  }

  assert.deepEqual(
    offences,
    [],
    'pg_restore --clean must never target the application database:\n' + offences.join('\n'),
  );
});

test('a spec that restores targets a database it created for the purpose', () => {
  // Recoverability is a property of the archive. Proving it needs a target that
  // can be thrown away; it never needed the live database, and using it there
  // turned a passing suite into an outage.
  for (const { name, code } of specFiles()) {
    if (!code.includes('pg_restore')) continue;
    // A reference to the tool without invoking it is not a restore.
    const invokes = /['"`]\s*,?\s*'pg_restore'/.test(code) || /\bpg_restore\s*,/.test(code);
    if (!invokes) continue;

    assert.ok(
      /CREATE\s+DATABASE/i.test(code),
      `${name} runs pg_restore but never creates a database to restore into`,
    );
    assert.ok(
      /scratch|sandbox|_isolated/i.test(code),
      `${name} restores without naming a disposable target database`,
    );
  }
});

test('no e2e spec truncates a table in the application database', () => {
  const offences = [];
  for (const { name, code } of specFiles()) {
    if (!code.includes('TRUNCATE')) continue;
    if (!mentionsLiveDatabase(code)) continue;
    for (const line of code.split('\n')) {
      if (!line.includes('TRUNCATE')) continue;
      if (/scratch|sandbox|_isolated/.test(line)) continue;
      offences.push(`${name}: ${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(offences, [], 'TRUNCATE must not run against the application database');
});
