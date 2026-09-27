import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * FC-DATA-001 — `+` on a decimal field must not be string concatenation.
 *
 * `Transaction.quantity` is `string | number` on the wire. `0 + "10.5"` is
 * `"010.5"`, so summing a decimal without converting it silently produces text.
 * This already happened once: the invoice subtotal was
 * `sortedRows.reduce((sum, row) => sum + row.quantity, 0)` and rendered as
 * `010.5`. TypeScript did not catch it because `reduce` infers `any` for an
 * untyped accumulator.
 *
 * Scope is deliberately narrow. A first attempt followed a decimal through a
 * local alias and produced four findings, three of them false positives, because
 * `const x = Number(field)` and `return -x` are both safe and look identical to
 * a regex. A guard that cries wolf gets deleted, so this one checks the shape
 * that actually caused the bug and nothing wider.
 */
const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
};

const DECIMAL = '(?:quantity|supplierNet|difference|packageCount|actualCount|packageWeight|orderLimit|minLimit|maxLimit)';
const UNCONVERTED = new RegExp('[+\\-]\\s*\\w+\\.' + DECIMAL + '\\b');
const HAS_NUMBER = new RegExp('Number\\([^)]*\\w+\\.' + DECIMAL);
// The accumulator must be untyped AND the summed expression must actually
// touch a decimal field, otherwise every `reduce((sum, x) => sum + x)` over
// column widths or densities matches and the guard is pure noise.
const UNTYPED_REDUCE = new RegExp(
  '\\.reduce\\(\\((\\w+)(?:\\s*:\\s*number)?\\s*,\\s*\\w+\\s*\\)\\s*=>\\s*\\1\\s*[+\\-][^;]*?\\w+\\.' + DECIMAL,
);
const TYPED_REDUCE = new RegExp('reduce\\(\\(\\w+\\s*:\\s*number\\s*,');

const scan = (files, isOffender) => {
  const hits = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (isOffender(trimmed)) hits.push(`${file}:${index + 1}  ${trimmed.slice(0, 100)}`);
    });
  }
  return hits;
};

const files = walk('frontend/src');

describe('FC-DATA-001 decimal arithmetic in the presentation layer', () => {
  it('does not add or subtract a decimal field without converting it', () => {
    const hits = scan(files, (line) => UNCONVERTED.test(line) && !HAS_NUMBER.test(line));
    assert.deepEqual(hits, [], `decimal arithmetic without a conversion:\n${hits.join('\n')}`);
  });

  it('declares the accumulator type when a reduce sums a decimal field', () => {
    // A reduce that already converts every operand is safe even with an
    // untyped accumulator, because `Number(x) * Number(y)` is arithmetic
    // whatever `sum` is inferred as. Only an unconverted operand is a hazard.
    const hits = scan(files, (line) => {
      if (!UNTYPED_REDUCE.test(line) || TYPED_REDUCE.test(line)) return false;
      const operands = line.slice(line.indexOf('=>') + 2);
      const fields = operands.match(new RegExp('\\w+\\.' + DECIMAL, 'g')) || [];
      if (fields.length === 0) return false;
      return fields.some((field) => !new RegExp('Number\\([^)]*' + field.replace('.', '\\.')).test(operands));
    });
    assert.deepEqual(hits, [], `reduce over a decimal field with an untyped accumulator:\n${hits.join('\n')}`);
  });

  it('proves the trap it guards is real', () => {
    // Without this, a change in JavaScript semantics would leave the guard
    // protecting against nothing while it still passed.
    assert.equal(String(0 + '10.5'), '010.5');
    assert.equal(0 + Number('10.5'), 10.5);
    assert.equal(UNCONVERTED.test('sum + row.quantity'), true, 'the guard must match the real bug shape');
  });
});
