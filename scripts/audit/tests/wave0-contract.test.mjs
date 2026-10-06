import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

/**
 * Wave 0's guarantees, pinned as structure rather than as behaviour.
 *
 * Both of these are configuration and schema facts that no unit test can reach: the
 * body-size limit lives in an nginx file that is only read by a running container, and
 * the rank default lives in a Prisma schema whose effect is only visible after a full
 * restore. End-to-end tests for both would mean uploading 20MB to a live proxy and
 * performing a real database restore — expensive, slow, and both would run against a
 * shared environment where a failure says as much about the machine as about the code.
 *
 * What can be pinned cheaply is that the *statement* of each guarantee is present, and
 * that a change to it is a deliberate act. That is weaker than a behavioural test and
 * it is stated as such here rather than dressed up as one: what it catches is someone
 * lowering the limit or dropping the default and not noticing, which is the realistic
 * regression. A behaviour that is never wired up cannot be caught by either, and both
 * of these are read by the real system on every start.
 */

test('the import body-size limit is declared in every proxy config that fronts the API', () => {
  // The import is the largest write the app makes, and it is the one the operator
  // triggers on a 500-row file. Without a declared limit nginx rejects the body with a
  // bare 413 before Nest ever sees it, and the studio reports a failure with no error
  // text — the operator cannot tell a too-big file from a broken server.
  //
  // Both configs are checked because they are two separate files serving two different
  // environments, and either one can be the only one that is deployed.
  for (const config of ['frontend/nginx.frontend.conf', 'nginx.prod.conf']) {
    assert.ok(existsSync(join(root, config)), `${config} must exist`);
    const source = read(config);
    assert.match(
      source,
      /client_max_body_size\s+20m/,
      `${config} must declare a 20m body limit. The default is 1m, which is smaller than a ` +
        '500-row import and would reject it with a bare 413 that the studio cannot explain.',
    );
  }
});

test('the import row limit and the body limit are the same order of magnitude', () => {
  // A body limit below what the maximum import needs is a contradiction the operator
  // only discovers by hitting it, with a bare 413 and no explanation.
  //
  // The row cap is configurable (`readInt`), so this reads the *default* out of the
  // call rather than assuming a literal — asserting on a literal would have failed
  // here and taught nothing, since the value is legitimately tunable per deployment.
  const limits = read('backend/src/item/import-limits.ts');
  const declared = /MAX_BULK_IMPORT_ROWS\s*=\s*readInt\(\s*'MAX_BULK_IMPORT_ROWS',\s*([\d_]+)/.exec(limits);
  assert.ok(declared, 'MAX_BULK_IMPORT_ROWS must be declared through readInt with a stated default');
  const maxRows = Number(declared[1].replace(/_/g, ''));
  assert.ok(maxRows > 0, 'the default row cap must be positive');

  // 15,000 rows of JSON is a few megabytes, so 20m is the right order of magnitude and
  // a default of 1m would reject a legitimate file. The check is deliberately a range:
  // it catches a cap that has drifted by an order of magnitude in either direction,
  // which is the realistic regression, and it does not second-guess a tuning decision.
  assert.ok(
    maxRows <= 200_000,
    `the default row cap is ${maxRows}; the 20m body limit is sized for the documented ` +
      'maximum, so changing this is a decision about the proxy too.',
  );
  assert.ok(
    maxRows >= 1_000,
    `the default row cap is only ${maxRows}, which is small enough that the 20m body limit ` +
      'is doing no work — check that this is still the intended maximum.',
  );
});

test('the rank column carries a default, so a restored row is never null', () => {
  // A restored item with no rank would sort unpredictably — the read path breaks ties by
  // id, so the operator's order would come back in insertion order of the *dump*, which
  // is not the order they arranged. The default puts every restored row at the same
  // sentinel, which the import then appends after.
  const schema = read('backend/prisma/schema.prisma');
  assert.match(
    schema,
    /sortOrder\s+Int\?\s+@default\(1000000\)/,
    'Item.sortOrder must carry a default. Without one a restore can leave it null, and ' +
      'the catalogue order is then decided by the dump rather than by the operator.',
  );
});
