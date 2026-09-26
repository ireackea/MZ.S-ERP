// FC-API-002 — Report module ownership and contracts.
// Fails if a second movement classifier appears, if the printing shim starts
// touching the database, or if a duplicate report module/template returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const canonicalService = read('backend/src/report/report.service.ts');
const printService = read('backend/src/reports/report.service.ts');
const transactionService = read('backend/src/transaction/transaction.service.ts');
const classifier = read('backend/src/common/operation-type.ts');
const aliases = read('backend/src/common/operation-type-aliases.ts');

test('movement classification is defined exactly once', () => {
  // The canonical definition.
  assert.match(classifier, /export const classifyMovement/);
  assert.match(classifier, /export const movementDelta/);
  assert.match(aliases, /const ALIASES/);

  // No module may re-derive direction with substring matching.
  for (const [name, source] of [
    ['report.service', canonicalService],
    ['reports.service', printService],
    ['transaction.service', transactionService],
  ]) {
    const code = stripComments(source);
    assert.ok(
      !/includes\(\s*['"]in['"]\s*\)/.test(code),
      `${name} re-introduced a bare 'in' substring test`,
    );
    assert.ok(
      !/includes\(\s*['"]out['"]\s*\)/.test(code),
      `${name} re-introduced a bare 'out' substring test`,
    );
  }
});

test('all three modules delegate to the canonical classifier', () => {
  assert.match(canonicalService, /from '\.\.\/common\/operation-type'/);
  assert.match(canonicalService, /return movementDelta\(row\)/,
    'the report service must delegate its delta');
  assert.match(printService, /from '\.\.\/common\/operation-type'/);
  assert.match(printService, /isInboundType\(row\.type\)/,
    'the printer must classify with the canonical helper');
  assert.match(transactionService, /from '\.\.\/common\/operation-type'/);
  assert.match(transactionService, /return movementDelta\(\{ type, quantity, adjustmentDirection \}\)/,
    'the stock ledger must use the same delta rule as the reports');
  assert.match(transactionService, /from '\.\.\/common\/operation-type-aliases'/);
});

test('the printing shim performs no aggregation of its own', () => {
  const code = stripComments(printService);
  // It may count rows for a printed summary, but never query the database.
  assert.ok(!/PrismaService/.test(code), 'reports/ must not import PrismaService');
  assert.ok(!/prisma\./.test(code), 'reports/ must not query the database');
  // It must not invent a second direction rule.
  const summary = printService.slice(printService.indexOf('private extractSummary'));
  assert.ok(
    !/lowerType|type.*toLowerCase\(\).*includes/.test(stripComments(summary)),
    'the printed summary must not re-derive direction',
  );
  assert.match(summary, /isInboundType/);
  assert.match(summary, /isOutboundType/);
  assert.match(summary, /isStockAdjustmentType/);
});

test('the canonical report module owns data, aggregation and PDF rendering', () => {
  const controller = read('backend/src/report/report.controller.ts');
  assert.match(controller, /@Get\(\)/, 'GET /reports must be owned here');
  assert.match(controller, /@Post\('generate'\)/);
  assert.match(controller, /reports\.view/);
  assert.match(controller, /reports\.generate/);

  const render = read('backend/src/report/render-pdf.controller.ts');
  assert.match(render, /@Post\('render-pdf'\)/);

  const print = read('backend/src/reports/report.controller.ts');
  assert.match(print, /@Post\('print'\)/);
  assert.match(print, /reports\.generate/);
});

test('both report services apply the shared time and scope rules', () => {
  // Date boundaries come from TimeService, never from local calendar maths.
  assert.match(canonicalService, /TimeService/);
  assert.match(canonicalService, /this\.timeService\.parseDate/);
  assert.match(canonicalService, /warehouseScopeCondition/);

  // The controller derives scope from the principal, never from the query.
  const controller = read('backend/src/report/report.controller.ts');
  assert.match(controller, /resolveWarehouseScope\(req\.user\?\.role\)/);

  // A global scope may narrow, but a scoped user may not widen.
  assert.match(canonicalService, /scope === 'all' && dto\.warehouseIds/,
    'warehouse narrowing must be gated on a global scope');
});

test('aggregates round to stored precision and never emit a signed zero', () => {
  assert.match(classifier, /export const roundQuantity/);
  assert.match(classifier, /rounded === 0 \? 0 : rounded/,
    'roundQuantity must normalise -0');
  assert.match(classifier, /delta === 0 \? 0 : delta/,
    'movementDelta must normalise -0');
  assert.match(classifier, /export const summariseMovements/);
  assert.match(classifier, /export const emptyMovementTotals/);
  // The report service must round, not emit raw float sums.
  assert.match(canonicalService, /toFixed\(3\)|roundQuantity/);
});

test('no duplicate report module, controller or template remains in src', () => {
  const reportDir = join(repoRoot, 'backend/src/report');
  const reportsDir = join(repoRoot, 'backend/src/reports');

  const listTs = (dir) => readdirSync(dir).filter((n) => n.endsWith('.ts')).sort();
  assert.deepEqual(listTs(reportDir), [
    'render-pdf.controller.ts',
    'report.controller.ts',
    'report.module.ts',
    'report.service.ts',
  ]);
  assert.deepEqual(listTs(reportsDir), ['report.controller.ts', 'report.module.ts', 'report.service.ts']);

  // The stale broken snapshot and the duplicate templates are archived away.
  assert.ok(!existsSync(join(reportDir, 'report.service.ts.broken-2026-02-28-runtime-start')));
  assert.ok(!existsSync(join(reportDir, 'templates')), 'the duplicate template dir must be gone');
  assert.ok(!existsSync(join(reportsDir, 'templates')), 'the duplicate template dir must be gone');
});

test('the ownership boundary is documented', () => {
  const doc = read('backend/src/report/OWNERSHIP.md');
  assert.match(doc, /CANONICAL/);
  assert.match(doc, /COMPATIBILITY SHIM/);
  assert.match(doc, /GET\s+\/api\/reports/);
  assert.match(doc, /POST\s+\/api\/reports\/print/);
  // Both modules are still registered, deliberately.
  const appModule = read('backend/src/app.module.ts');
  assert.match(appModule, /ReportModule/);
  assert.match(appModule, /ReportsModule/);
});
