import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

/**
 * The encoding gate is the first step of `ci:verify`, so when it is red nothing
 * after it runs at all.
 *
 * It was red for two independent reasons and only one of them was the missing
 * `.env`. This guard is about the other one. `suspiciousCharsRegex` listed four
 * characters that are legitimate Arabic typography rather than a corruption
 * signature, so the gate failed on ten files that had never been edited — and on
 * the ellipsis inside the operator-facing order profiles panel. The gate is
 * scanned by itself, so the code points below are written bare and never as
 * literal glyphs: putting a real one in this file would flag this file.
 *
 * The rule this encodes: the list may only contain characters that a Windows-1252
 * mis-decode *produces*. Giving up the author's own punctuation must not extend
 * to giving up the 1252 halves, because those halves are the only thing the list
 * is for.
 */

// [codePoint, why it must stay]
const REQUIRED_SIGNATURE = [
  ['20AC', 'euro sign: one half of a mis-decoded ellipsis'],
  ['00A6', 'broken bar: the other half of a mis-decoded ellipsis'],
  ['00A7', 'section sign: the opening glyph of a mis-decoded Arabic run'],
  ['00B1', 'plus-minus: appears in mis-decoded superscript pairs'],
  ['00B2', 'superscript two: appears in mis-decoded fractions'],
  ['FFFD', 'the replacement character, which is never legitimate'],
  ['00A9', 'copyright: a classic mis-decode result'],
  ['00AD', 'soft hyphen: a frequent mis-decode result'],
  ['00B5', 'micro sign: appears in mis-decoded microsecond strings'],
  ['00A2', 'cent sign: appears in mis-decoded currency strings'],
];

// [codePoint, why it was removed]
const REMOVED_TYPOGRAPHY = [
  ['2026', 'horizontal ellipsis: ordinary in Arabic interface text'],
  ['00B7', 'middle dot: used as a separator throughout this product'],
  ['00AB', 'left guillemet: used around quoted names'],
  ['00B4', 'acute accent: appears in loanwords'],
];

const listedCodePoints = () => {
  const source = read('scripts/check-text-encoding.mjs');
  const match = /const suspiciousCharsRegex\s*=\s*\/\[([^\]]+)\]\/u/.exec(source);
  assert.ok(
    match,
    'suspiciousCharsRegex was restructured. Point this guard at the new form rather than deleting it, ' +
      'and keep the guarantee it encoded: the list is the only thing that catches a mis-decoded file.',
  );
  return {
    source,
    // Escape sequences must be matched as units. Splitting the class body into
    // single characters yields backslash-u-0-0-A-7 and compares nothing.
    codes: new Set(
      [...match[1].matchAll(/\\u([0-9A-Fa-f]{4})/g)].map((entry) => entry[1].toUpperCase()),
    ),
    classBody: match[1],
  };
};

test('the encoding gate still lists the Windows-1252 signature characters', () => {
  const { source, codes } = listedCodePoints();

  for (const [code, why] of REQUIRED_SIGNATURE) {
    assert.ok(
      codes.has(code),
      `U+${code} is missing from suspiciousCharsRegex. ${why.charAt(0).toUpperCase()}${why.slice(1)}. ` +
        'Every Windows-1252 mis-decode produces at least one listed character. If an entry here looks ' +
        'unnecessary, prove it with a mis-decoded sample instead of removing it.',
    );
    assert.ok(
      source.includes(`\\u${code}`),
      `U+${code} must be written as an escape in the source. The gate scans every .mjs file, ` +
        'including the one that defines it, so a literal glyph here would flag this project.',
    );
  }
});

test('the characters removed as legitimate typography stay removed', () => {
  const { classBody } = listedCodePoints();

  for (const [code, why] of REMOVED_TYPOGRAPHY) {
    assert.ok(
      !classBody.includes(`\\u${code}`),
      `U+${code} is back in the list. ${why.charAt(0).toUpperCase()}${why.slice(1)}. Its mis-decoded ` +
        'form still trips the retained entries (an ellipsis expands into U+20AC and U+00A6), so listing ' +
        'the rendered character only fails the gate on files nobody edited.',
    );
  }
});

test('the gate scans Markdown, and a control character fails it anywhere', () => {
  const source = read('scripts/check-text-encoding.mjs');

  // `.md` was missing from the extension set, so the two remediation plans had never
  // been opened by this gate — and that is where the damage was: a U+0007 had eaten
  // the `a` of `archive-key.ts`, and a U+0008 the `b` of `backup-reconcile.ts`, in a
  // file nothing else reads.
  const extensions = /const extensions = new Set\(\[([^\]]+)\]\)/.exec(source);
  assert.ok(extensions, 'the extension set was restructured; point this guard at its new form.');
  assert.ok(
    extensions[1].includes("'.md'"),
    "'.md' must be in the gate's extension set. Nothing else opens a Markdown file, so a plan " +
      'document can accumulate encoding damage indefinitely and still pass every check.',
  );

  // The tokenized heuristic only fires on control characters sitting next to two
  // digits and a marker, which is the shape a mis-decode leaves. A control character
  // arriving any other way was invisible: the two in this repository arrived inside a
  // JSDoc comment and a table row, with no digit nearby.
  assert.match(source, /function findControlCharacters\(text\)/);
  const body = /function findControlCharacters\(text\)\s*\{[\s\S]*?\n\}/.exec(source);
  assert.ok(body, 'findControlCharacters was restructured; point this guard at its new form.');
  assert.match(body[0], /code !== 0x09 && code !== 0x0d/, 'tab and carriage return are the two legitimate controls');
  assert.match(body[0], /ignoreLineMarker/, 'the per-line escape hatch must survive');
});

test('a Markdown typography hit is reported without failing the gate', () => {
  const source = read('scripts/check-text-encoding.mjs');

  // The asymmetry is deliberate and it is the second time this gate has been wrong
  // about typography: a Windows-1252 half is unambiguous in source and legitimate
  // in Arabic prose, so in Markdown it is reported and the file is not failed.
  // What stays fatal is the replacement character, which has no innocent reading.
  assert.match(source, /advisoryCharFindings/);
  assert.match(source, /finding\.code === 'U\+FFFD'/);
  assert.match(source, /\(advisory\)/);
});

test('the gate still runs first in the verification chain', () => {
  const scripts = JSON.parse(read('package.json')).scripts || {};
  const verify = String(scripts['ci:verify'] || '');
  assert.ok(verify.length > 0, 'ci:verify must exist.');

  assert.ok(
    verify.startsWith('npm run check:encoding'),
    'check:encoding must stay the first step of ci:verify. A red first step means no later step runs, ' +
      'which is how this gate stayed broken unnoticed: the only visible symptom was a failure at the ' +
      'top of a list of unrelated steps, and it was attributed to whichever step followed.',
  );
});
