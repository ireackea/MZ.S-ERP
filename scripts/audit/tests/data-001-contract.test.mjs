// FC-DATA-001 — Decimal-safe API contract.
// Fails if a Prisma Decimal column is not covered by the boundary, if a money or
// quantity field can still be written as an imprecise float, or if the ledger
// invariant is no longer enforced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const decimalModule = read('backend/src/common/decimal.ts');
const schema = read('backend/prisma/schema.prisma');

/** Every `Decimal` column declared in the Prisma schema. */
const schemaDecimalFields = () => {
  const fields = new Set();
  let inModel = false;
  for (const line of schema.split(/\r?\n/)) {
    if (/^model\s+\w+\s*\{/.test(line)) { inModel = true; continue; }
    if (/^\}/.test(line)) { inModel = false; continue; }
    if (!inModel) continue;
    // e.g. `  minLimit        Decimal          @default(0)` or `quantity  Decimal?`
    const match = line.match(/^\s{2,}(\w+)\s+Decimal\??(\s|$)/);
    if (match) fields.add(match[1]);
  }
  return fields;
};

test('every Prisma Decimal column is covered by the boundary', () => {
  const declared = schemaDecimalFields();
  assert.ok(declared.size >= 15, `expected many Decimal columns, found ${declared.size}`);

  const block = decimalModule.slice(
    decimalModule.indexOf('export const DECIMAL_FIELDS'),
    decimalModule.indexOf('] as const;'),
  );
  const covered = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));

  const missing = [...declared].filter((field) => !covered.has(field));
  assert.deepEqual(missing, [],
    `Prisma Decimal columns not covered by DECIMAL_FIELDS: ${missing.join(', ')}`);
});

test('the boundary refuses imprecise input and non-canonical spellings', () => {
  assert.match(decimalModule, /export const parseDecimal/);
  assert.match(decimalModule, /send decimals as strings/,
    'a non-integer JS float must be refused, not coerced');
  assert.match(decimalModule, /FULL_ACCESS_DECIMAL/,
    'exponent notation / NaN / Infinity must be rejected');
  assert.match(decimalModule, /at most \$\{scale\} decimal places|must be <= |must be >= /);
  assert.match(decimalModule, /export const DECIMAL_STRING_PATTERN/);
});

test('scale and maximum are enforced centrally, not per call site', () => {
  assert.match(decimalModule, /export const DECIMAL_SCALE = 3/);
  assert.match(decimalModule, /export const DECIMAL_MAX = '999999999\.999'/);
  assert.match(decimalModule, /options\.scale \?\? DECIMAL_SCALE/);
  // The ceiling is a default, not an opt-in: `options.max ?? DECIMAL_MAX` means
  // a caller cannot forget to bound a value and let 1e12 reach the column.
  assert.match(decimalModule, /const ceiling = options\.max \?\? DECIMAL_MAX/);
  assert.match(decimalModule, /must be <= \$\{ceiling\}/);
});

test('a malformed decimal is reported as a 400, not an opaque 500', () => {
  assert.match(decimalModule, /class DecimalBoundaryError extends BadRequestException/,
    'bad client input must not surface as a server fault');
  assert.match(decimalModule, /import \{ BadRequestException \} from '@nestjs\/common'/);
});

test('the DTO layer accepts a decimal string instead of demanding a JSON number', () => {
  const validation = read('backend/src/common/decimal-validation.ts');
  assert.match(validation, /export const IsDecimalString/);
  assert.match(validation, /parseDecimal\(value, args\.property/,
    'the validator must reuse the one boundary rule, not re-implement it');
  assert.match(validation, /has already lost precision/i);

  // A quantity typed as a number would make precision unrepresentable, so the
  // transaction DTOs must declare it as a DecimalString.
  for (const file of [
    'backend/src/transaction/dto/create-transaction.dto.ts',
    'backend/src/transaction/dto/update-transaction.dto.ts',
  ]) {
    const dto = read(file);
    assert.match(dto, /quantity!?\??: DecimalString;/, `${file} must type quantity as DecimalString`);
    assert.doesNotMatch(dto, /quantity!?: number;/, `${file} must not type quantity as number`);
    assert.match(dto, /@IsDecimalString\(\)/);
  }
});

test('the wire form is a string, never a float', () => {
  assert.match(decimalModule, /export const toDecimalString/);
  assert.match(decimalModule, /decimal\.toFixed\(scale\)/);
  assert.match(decimalModule, /export type DecimalString = string/);
  assert.match(decimalModule, /export const serializeDecimal/);
});

test('arithmetic never accumulates in a JS float', () => {
  assert.match(decimalModule, /export const sumDecimals/);
  assert.match(decimalModule, /export const subtractDecimals/);
  // A float-only helper would reintroduce 0.1 + 0.2 drift.
  const arithmetic = decimalModule.slice(
    decimalModule.indexOf('export const sumDecimals'),
    decimalModule.indexOf('export const toDecimalString') > -1
      ? decimalModule.indexOf('export const toDecimalString')
      : decimalModule.length,
  );
  assert.ok(!/values\.reduce\(\s*\(?\s*(acc|total)\s*,\s*\w+\)\s*=>\s*\w+\s*\*\s*\w+/i.test(arithmetic),
    'a float multiply-accumulate would reintroduce drift');
});

test('the ledger balance invariant is asserted, not assumed', () => {
  assert.match(decimalModule, /export const assertLedgerInvariant/);
  assert.match(decimalModule, /export const ledgerNet/);
  // The invariant must be net = in + returns + production - out - waste.
  const invariant = decimalModule.slice(decimalModule.indexOf('export const assertLedgerInvariant'));
  assert.match(invariant, /buckets\.inbound/);
  assert.match(invariant, /buckets\.returns/);
  assert.match(invariant, /buckets\.production/);
  assert.match(invariant, /buckets\.outbound/);
  assert.match(invariant, /buckets\.waste/);
  assert.match(invariant, /\.minus\(/);
});

test('a service write path uses the boundary instead of raw float arithmetic', () => {
  // At least one production write path must go through the boundary, otherwise
  // the module is dead code and precision is still unguarded.
  const service = read('backend/src/transaction/transaction.service.ts');
  assert.match(service, /from '\.\.\/common\/decimal'/,
    'the transaction service must import the decimal boundary');

  const decimalUsage = stripComments(service);
  assert.match(decimalUsage, /parseDecimal|toDecimalPayload|serializeDecimal|toDecimalString/,
    'the transaction service must actually use the boundary helpers');
});

test('the ledger invariant has a real test, not just an implementation', () => {
  const test_ = read('backend/src/common/decimal.test.ts');
  assert.match(test_, /0\.1 \+ 0\.2/);
  assert.match(test_, /999999999\.999/);
  assert.match(test_, /assertLedgerInvariant/);
  assert.match(test_, /deterministic randomised fixture/i,
    'the card requires a randomised deterministic fixture set');
});

test('every transaction write path goes through the decimal boundary', () => {
  // FC-CERTIFY-001 found this: the stock-adjustment path still did
  // `quantity: Number(dto.quantity)` after DATA-001 had converted the ordinary
  // movement path, so one route kept rounding through a float. A boundary that
  // only covers some routes is not a boundary.
  const service = read('backend/src/transaction/transaction.service.ts');
  const writes = stripComments(service);

  assert.doesNotMatch(writes, /quantity:\s*Number\(/,
    'a transaction quantity must never be coerced with Number()');
  assert.doesNotMatch(writes, /Number\(dto\.quantity\)/,
    'the adjustment magnitude must be parsed once, through parseDecimal');
  assert.match(writes, /const magnitude = parseDecimal\(dto\.quantity, 'quantity'\)/);
  // DEF-001 added a context argument so a clamped over-issue is attributable.
assert.match(writes, /applyStockDeltas\(tx, new Map\(\[\[itemId, delta\]\]\), \{/);

  // The adjustment DTO must share the boundary rather than keep its own
  // numeric min/max, which is what allowed the float through in the first place.
  const adjustmentDto = read('backend/src/transaction/dto/stock-adjustment.dto.ts');
  assert.match(adjustmentDto, /@IsDecimalString\(\)/);
  assert.match(adjustmentDto, /quantity!: DecimalString;/);
  assert.doesNotMatch(adjustmentDto, /@Type\(\(\) => Number\)/,
    'the adjustment DTO must not coerce quantity to a number');
});

test('every screen that builds a movement payload sends decimals as strings', () => {
  // This is the gap that reached production once: DATA-001 moved the wire contract
  // to decimal strings and the operations screen kept sending `Number(quantity)`,
  // so entering 10.5 tonnes produced a 400 with no obvious cause. Every test up
  // to that point drove the API directly, so nothing ever looked at the code that
  // builds the payload. These assertions are that missing check.
  const decimal = read('frontend/src/utils/decimal.ts');
  assert.match(decimal, /export const toApiDecimal/);
  assert.match(decimal, /export const toApiDecimalOptional/);
  assert.match(decimal, /has already lost precision/,
    'a float must be refused at the boundary rather than coerced');
  assert.match(decimal, /typeof input === 'string'/, 'a typed value must be passed through, not parsed and re-stringified');

  const types = read('frontend/src/types.ts');
  assert.match(types, /export type DecimalValue = string \| number/,
    'the type must admit both so a cast cannot hide a float');

  // The two writers of a movement payload.
  for (const file of [
    'frontend/src/services/transactionsService.ts',
    'frontend/src/components/DailyOperations.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /import \{[^}]*\} from '[^']*utils\/decimal'/,
      `${file} must import the decimal boundary`);
    assert.match(source, /quantity: toApiDecimal\(/,
      `${file} must send quantity through toApiDecimal`);
    assert.doesNotMatch(source, /quantity: Number\(/,
      `${file} must not send a float for quantity`);
  }

  // The offline queue replays the persisted body verbatim, so a float stored in
  // IndexedDB would be refused on replay long after the operator left.
  assert.match(read('frontend/src/components/DailyOperations.tsx'),
    /quantity: toApiDecimal\(form\.quantity, 'quantity'\) as string/);
});

test('the orders quantity is bounded the same way a movement quantity is', () => {
  // A movement requires a decimal string, an order line still takes a number.
  // That inconsistency is deliberate for now and worth pinning rather than
  // silently drifting: a human types 0.1 into a number input, Number() of that
  // string is exact, and Prisma.Decimal preserves it, so the order line is not
  // broken the way the operations screen was. What must not happen is the order
  // line losing its bound, because then a stray 1e12 would be accepted into a
  // Decimal column with no ceiling at all.
  const orderDto = read('backend/src/orders/dto/order.dto.ts');
  assert.match(orderDto, /quantity!: number/);
  assert.match(orderDto, /@Min\(0\.001\)/, 'an order line must have a lower bound');
  assert.match(orderDto, /@Max\(999999999\.999\)/, 'and the same ceiling a movement has');

  // The decimal fields list must include the order quantity, so a future
  // tightening of that list cannot drop it unnoticed.
  assert.match(read('backend/src/common/decimal.ts'), /'quantity'/);
});
