import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('stock adjustment contract persists reason, source, and direction', () => {
  const dto = read('backend/src/transaction/dto/stock-adjustment.dto.ts');
  const schema = read('backend/prisma/schema.prisma');
  const migration = read('backend/prisma/migrations/20260925120000_add_stock_adjustment_fields/migration.sql');
  assert.match(dto, /adjustmentDirection/);
  assert.match(dto, /reason/);
  assert.match(dto, /sourceReference/);
  assert.match(schema, /adjustmentReason/);
  assert.match(schema, /adjustmentSourceReference/);
  assert.match(schema, /adjustmentDirection/);
  assert.match(migration, /adjustmentReason/);
  assert.match(migration, /adjustmentSourceReference/);
  assert.match(migration, /adjustmentDirection/);
});

test('stock adjustment command and reconciliation are permissioned and idempotent', () => {
  const controller = read('backend/src/transaction/transaction.controller.ts');
  const balancesController = read('backend/src/transaction/balances.controller.ts');
  const service = read('backend/src/transaction/transaction.service.ts');
  const workflow = read('.github/workflows/main.yml');
  assert.match(controller, /transactions\.adjust/);
  assert.match(controller, /stock-adjustments/);
  assert.match(balancesController, /transactions\.reconcile/);
  assert.match(balancesController, /reconciliation/);
  assert.match(service, /createStockAdjustment/);
  assert.match(service, /getStockReconciliation/);
  assert.match(service, /STOCK_ADJUSTMENT/);
  // FC-CERTIFY-001 replaced the float-based adjustment helper with a Decimal one:
// `toAdjustmentDelta(direction, number)` became `toDecimalDelta(type, Decimal)`,
// because the update path has to subtract two quantities and a float leaves a
// residue on the ledger. The direction is still applied; it just no longer
// rounds on the way to the column.
assert.match(service, /toDecimalDelta/);
assert.match(service, /const magnitude = parseDecimal\(dto\.quantity, 'quantity'\)/);
assert.doesNotMatch(service, /Number\(dto\.quantity\)/);
  assert.match(service, /executeIdempotently/);
  assert.match(service, /Serializable/);
  assert.match(service, /applyStockDeltas/);
  assert.match(workflow, /Stock adjustment and reconciliation E2E/);
});

test('inventory reports include stock adjustment movements', () => {
  const report = read('backend/src/report/report.service.ts');
  // FC-API-002: the adjustment vocabulary moved to the canonical classifier and
  // alias table, so the report service delegates instead of re-listing it.
  const classifier = read('backend/src/common/operation-type.ts');
  const aliases = read('backend/src/common/operation-type-aliases.ts');

  assert.match(report, /adjustmentDirection/);
  assert.match(report, /getMovementDelta/);
  assert.match(report, /from '\.\.\/common\/operation-type'/);

  assert.match(classifier, /STOCK_ADJUSTMENT/);
  assert.match(classifier, /adjustmentDirection/);
  assert.match(aliases, /stock_adjustment|stock adjustment/i);
  assert.match(aliases, /STOCK_ADJUSTMENT/);
});
