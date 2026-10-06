import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const methodBody = (source, signature) => {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} was not found`);
  const end = source.indexOf('\n  async ', start + signature.length);
  const nextPrivate = source.indexOf('\n  private ', start + signature.length);
  const candidates = [end, nextPrivate].filter((value) => value > start);
  const stop = candidates.length ? Math.min(...candidates) : undefined;
  return source.slice(start, stop === undefined ? undefined : stop);
};

const service = () => stripComments(read('backend/src/item/item.service.ts'));

/**
 * Two structural properties that no behavioural test can reach, because both are about
 * *where* a call appears rather than what it returns.
 *
 * A broadcast inside a transaction is the interesting one. It compiles, it passes every
 * functional test, and it is wrong: the announcement goes out before the commit, so a
 * subscriber refreshes and reads a catalogue that does not contain the change yet. If
 * the transaction then rolls back, the subscriber has already told somebody the rows
 * exist. It is the one class of bug that a green suite and a broken system produce
 * together, which is exactly why it needs a guard that reads the source.
 */
/**
 * The body of the first `async (tx) => {` after `offset`, found by counting braces.
 *
 * A regex for "up to the closing brace" is a guess about formatting, and it breaks the
 * first time somebody reformats a file — which teaches people to ignore the guard
 * rather than to fix the code. Counting braces is formatting-independent.
 */
const braceMatchedBody = (source, from) => {
  const start = source.indexOf('{', from);
  assert.notEqual(start, -1, 'no callback body found');
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    // Braces inside strings and comments do not nest. Both are stripped or escaped
    // below; this only needs to not be fooled by a `{` in a message.
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
};

test('no realtime announcement is made from inside a transaction', () => {
  const body = methodBody(service(), 'async bulkImportFromExcel');

  const callbackAt = body.indexOf('async (tx) => {');
  assert.ok(callbackAt >= 0, 'the import must still use a transaction callback');
  const inside = braceMatchedBody(body, callbackAt);

  for (const call of ['emitItemsChanged', 'realtime.', 'broadcast', '.emit(']) {
    assert.doesNotMatch(
      inside,
      new RegExp(call.replace('(', '\\(')),
      `${call} appears inside the transaction. A subscriber would refresh before the commit ` +
        'and be told about rows that may not exist — and told so again, in reverse, if the ' +
        'transaction rolls back afterwards.',
    );
  }
});

test('the broadcast still happens for a committed import, after the commit', () => {
  // The other half. A guard that only forbade the inside would be satisfied by deleting
  // the announcement, and other sessions would silently stop seeing changes.
  const body = methodBody(service(), 'async bulkImportFromExcel');
  assert.match(
    body,
    /outcome\.value\.success > 0\)\s*\{[\s\S]{0,160}emitItemsChanged\(/,
    'the announcement must still be made, and it must be gated on what the commit actually did',
  );
});

test('the downloaded template is generated from the field list, not written out', () => {
  // `EXCEL_TEMPLATE_ROWS` used to be a hand-maintained array of column labels. It drifted
  // from the field list: it kept offering `currentStock`, a column the server refuses, so
  // an operator filled in their stock figures, watched the preview go green, and every
  // item landed at zero with no message.
  //
  // Generating it from the list makes that class of drift unrepresentable. The guard is
  // on the *shape* rather than on the contents, because a contents check would have to
  // re-state the list in a second place — which is the thing being removed.
  const shared = read('frontend/src/pages/items/shared.ts');
  assert.match(
    shared,
    /EXCEL_TEMPLATE_ROWS[\s\S]{0,80}?\[\s*buildImportTemplateRow\(\)\s*\]/,
    'the template must be built from the single field list. A hand-written header array is ' +
      'the defect, not the thing this guard protects. The bound is loose on purpose: a guard ' +
      'that fails when somebody adds a type annotation is a guard people learn to route around.',
  );
  assert.doesNotMatch(
    shared,
    /EXCEL_TEMPLATE_ROWS[\s\S]{0,80}?currentStock/,
    'the template must not hard-code a column, least of all one the server refuses',
  );
});

test('the payload builder copies from the field list, not from a hand-written key list', () => {
  // The counterpart to the template guard, from the sending end. `toImportPayload` used
  // to be a destructuring line listing the fields by name, which meant a field added
  // to the list appeared in the template and the studio but was never sent — the
  // operator filled in a column the template offered and the value went nowhere.
  //
  // `englishName` is the concrete case: it was in the DTO, in the template and in the
  // exporter, and the payload folded it into `description` and dropped it.
  const service = read('frontend/src/services/itemsService.ts');
  const builder = methodBody(service, 'const toImportPayload');

  assert.match(
    builder,
    /for \(const definition of IMPORTABLE_FIELDS\)/,
    'the payload must be built by projecting the field list, so a new field cannot be ' +
      'offered for download and then silently dropped on the way in',
  );
  assert.doesNotMatch(
    builder,
    /currentStock/,
    'the payload must never copy `currentStock`. The ledger owns stock, and sending it ' +
      'would fail the whole request under `forbidNonWhitelisted` rather than ignore it.',
  );
});
