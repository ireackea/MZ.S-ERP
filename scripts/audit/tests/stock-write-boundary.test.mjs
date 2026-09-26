import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('ordinary item sync cannot write currentStock', () => {
  const dto = read('backend/src/item/dto/sync-items.dto.ts');
  assert.doesNotMatch(dto, /currentStock/);
  assert.doesNotMatch(dto, /currentStock\?/);
});

test('bulk item import cannot write currentStock as ordinary metadata', () => {
  const dto = read('backend/src/item/dto/bulk-import.dto.ts');
  assert.doesNotMatch(dto, /currentStock/);
});

test('item service has no direct currentStock write in sync or import paths', () => {
  const service = read('backend/src/item/item.service.ts');
  const syncSection = service.slice(service.indexOf('async syncItems'), service.indexOf('async findAll'));
  const importSection = service.slice(service.indexOf('async bulkImportFromExcel'), service.indexOf('// Phase 5: Upload Attachment'));
  assert.doesNotMatch(syncSection, /currentStock\s*:/);
  assert.doesNotMatch(importSection, /currentStock\s*:/);
  assert.doesNotMatch(importSection, /item\.currentStock/);
});

test('item form no longer submits unsupported product fields as if they were persisted', () => {
  const form = read('frontend/src/components/ItemForm.tsx');
  assert.doesNotMatch(form, /toApiPayload/);
  assert.doesNotMatch(form, /apiClient\.post\(['"]\/items['"]/);
  assert.doesNotMatch(form, /apiClient\.put\([^\n]*\/items\//);
  assert.doesNotMatch(form, /toSyncPayload/);
});

test('transaction service centralizes currentStock writes in the stock delta helper', () => {
  const service = read('backend/src/transaction/transaction.service.ts');
  const helperStart = service.indexOf('private async applyStockDeltas');
  const helperEnd = service.indexOf('private resolvePreferredPublicId');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);

  const helper = service.slice(helperStart, helperEnd);
  const outsideHelper = `${service.slice(0, helperStart)}${service.slice(helperEnd)}`;
  // FC-DATA-001: the increment is a Prisma.Decimal, so a fractional delta never
  // round-trips through a JS float on its way to the column. DEF-001 then routes
  // it through planMovement, so the value is plan.appliedDelta: clamped at zero.
  assert.match(helper, /currentStock\s*:\s*\{\s*increment:\s*plan\.appliedDelta\s*\}/);
  assert.match(helper, /delta instanceof Prisma\.Decimal/,
    'the helper must accept a Decimal delta without re-parsing it as a float');
  assert.doesNotMatch(outsideHelper, /currentStock\s*:\s*\{\s*increment:/);
  assert.match(service, /await this\.applyStockDeltas\(tx, stockDeltaByItemId, \{/);
});

test('the API contract test documents the current stock write boundary', () => {
  const plan = read('.hermes/plans/2026-09-24_mzs-erp-remediation-plan.md');
  assert.match(plan, /currentStock.*ledger|ledger.*currentStock/i);
  assert.match(plan, /stock adjustment/i);
});
