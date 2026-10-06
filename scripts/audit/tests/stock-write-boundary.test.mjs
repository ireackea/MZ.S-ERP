import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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
  // Slice only the import method, not everything up to the next "Phase 5" comment.
  // `revertImportBatch` was added between the import and that marker in Wave 3, and it
  // legitimately *reads* `currentStock` from a SELECT to decide whether to refuse —
  // refusing on a non-zero balance is the entire point of a revert. The guard is about
  // *writing* stock, so it must not reach across a method boundary into a read.
  const importSection = service.slice(
    service.indexOf('async bulkImportFromExcel'),
    service.indexOf('private async readExistingImportKeys'),
  );
  assert.doesNotMatch(syncSection, /currentStock\s*:/);
  assert.doesNotMatch(importSection, /currentStock\s*:/);
  assert.doesNotMatch(importSection, /item\.currentStock/);
});

test('the dead item form is gone, and stays gone', () => {
  // This used to assert that `ItemForm.tsx` did not submit stock or unsupported
  // fields. It was guarding a live hazard in a file nothing imported: 27KB of a form
  // with its own payload builders, reachable by anyone who decided to route to it.
  //
  // Wave 4 deleted it. The hazard went with the file, so reading the file to check its
  // contents was checking a corpse — and the moment it stopped existing, the guard
  // threw ENOENT and failed for a reason that had nothing to do with stock.
  //
  // The property that still matters is that it does not come back. A resurrected form
  // with a hand-built payload is the failure this whole file exists to prevent, and a
  // deleted component is a real thing to keep deleted.
  const formPath = 'frontend/src/components/ItemForm.tsx';
  assert.equal(
    existsSync(join(root, formPath)),
    false,
    `${formPath} is dead code with its own payload builders and no importer. If a screen ` +
      'genuinely needs it, reimplement it against itemWriteData rather than restoring this.',
  );
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
