// DEF-001 - a stock deficit ledger.
//
// The naive fix for a negative balance is to clamp the number. That fix alone
// breaks the ledger: the movement is still recorded at its full magnitude while
// the balance shows zero, so every report that re-derives the balance from the
// movements disagrees with the item page. These assertions pin the model that
// actually holds: currentStock = ledgerNet + openDeficit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

const deficit = read('backend/src/common/stock-deficit.ts');
const service = read('backend/src/transaction/transaction.service.ts');
const deficitService = read('backend/src/stockdeficit/stock-deficit.service.ts');
const controller = read('backend/src/stockdeficit/stock-deficit.controller.ts');
const schema = read('backend/prisma/schema.prisma');
const test_ = read('backend/src/common/stock-deficit.test.ts');

test('the invariant is stated in the domain, not just implied', () => {
  assert.match(deficit, /currentStock === ledgerNet \+ openDeficit/,
    'the model must state the invariant it maintains');
  assert.match(deficit, /export const assertDeficitInvariant/);
  assert.match(deficit, /violated: currentStock=/);
  assert.match(deficit, /export const availableStock/);
});

test('every movement is planned, so the clamp cannot be bypassed', () => {
  // One writer, one planner. A second `currentStock: { increment }` would let a
  // route go around the clamp entirely, which is exactly how the float paths
  // survived DATA-001.
  const writes = service.split('currentStock: { increment:');
  assert.equal(writes.length - 1, 1,
    'currentStock must be incremented in exactly one place');
  assert.match(service, /planMovement\(current\.currentStock, openDeficitTotal, decimal, this\.deficitPolicy\)/);
  assert.match(service, /stockDeficit\.create\(\{/,
    'an over-issue must record the shortfall');
});

test('a refused over-issue is a 400, not a 500 from the domain layer', () => {
  assert.match(service, /error instanceof StockOverIssueError/);
  assert.match(service, /throw new BadRequestException\(/);
  assert.match(service, /Issue exceeds the available balance/);
});

test('incoming stock settles debt before it becomes spendable', () => {
  assert.match(deficit, /Incoming stock pays down debt first/);
  assert.match(deficit, /const absorbed = movement\.gt\(debt\) \? debt : movement/);
  assert.match(deficit, /const applied = movement\.minus\(absorbed\)/);
});

test('a partial settlement opens a new record instead of rounding debt to zero', () => {
  // A first implementation closed the whole deficit on a partial payment, which
  // silently erased the remainder. The remainder has to stay visible.
  assert.match(service, /const leftover = entry\.quantity\.minus\(applied\)/);
  assert.match(service, /if \(leftover\.gt\(0\)\)/);
  assert.match(service, /quantity: leftover/);
});

test('the deficit is a durable row with a lifecycle, not a log line', () => {
  assert.match(schema, /model StockDeficit \{/);
  assert.match(schema, /quantity\s+Decimal/);
  assert.match(schema, /status\s+String\s+@default\("OPEN"\)/);
  assert.match(schema, /@@index\(\[itemId, status\]\)/);
  for (const status of ['OPEN', 'SETTLED_BY_RECEIPT', 'WRITTEN_OFF']) {
    assert.match(deficit, new RegExp(status), `the status ${status} must be a known value`);
  }
});

test('writing a deficit off demands a reason and stays attributable', () => {
  assert.match(deficitService, /at least 10 characters is required/);
  assert.match(deficitService, /is already .* and cannot be written off/);
  assert.match(deficitService, /resolvedById: input\.actorId/);
});

test('the queue is authenticated and resolving it is a separate permission', () => {
  assert.match(controller, /@UseGuards\(JwtAuthGuard, RbacGuard\)/,
    'an unguarded controller here would expose every item name to an anonymous caller');
  assert.match(controller, /@Permissions\('inventory\.view\.stocktaking'\)/);
  assert.match(controller, /@Permissions\('inventory\.adjust\.stock'\)/);
  const catalog = read('backend/src/auth/permission-catalog.ts');
  assert.match(catalog, /id: 'inventory\.adjust\.stock'/,
    'a route permission that is not in the catalog would 403 for everyone');
});

test('the policy is configurable but defaults to the safe option', () => {
  assert.match(deficit, /DEFAULT_DEFICIT_POLICY: DeficitPolicy = 'CLAMP_AND_ALERT'/);
  assert.match(service, /DEFICIT_POLICIES\.includes\(/);
  assert.match(service, /return DEFAULT_DEFICIT_POLICY;/);
});

test('the per-item totals honour the item filter', () => {
  // A first implementation aggregated every open deficit regardless of the
  // requested item, so one item's page reported another item's debt.
  assert.match(deficitService, /where: \{ \.\.\.where, status: 'OPEN' \}/);
});

test('the behaviour is proven, including a randomised sequence', () => {
  assert.match(test_, /holds after an over-issue is clamped/);
  assert.match(test_, /absorbs the outstanding deficit first/);
  assert.match(test_, /deterministic pseudo-random movement sequence/);
  const e2e = read('tests/e2e/def-001-stock-deficit.spec.ts');
  assert.match(e2e, /the balance must never go negative/);
  assert.match(e2e, /currentStock = ledgerNet \+ openDeficit throughout/);
  assert.match(e2e, /a one-word reason is not an audit trail/);
});

test('a new deficit is announced, and only after the transaction commits', () => {
  // The whole promise of a deficit is that somebody is told. Without this the
  // row is written and nobody finds out until they run the reconciliation, which
  // is the silent corruption the card was opened to prevent.
  assert.match(service, /private announceDeficits\(/);
  assert.match(service, /'stock\.deficit-recorded'/);
  assert.match(service, /conflict: true/,
    'a deficit is a conflict the operator has to resolve, not an informational sync');

  // The announcement must be collected inside the transaction and emitted after,
  // because emitting inside would tell every connected client about a shortfall
  // that a rollback then erases.
  assert.match(service, /const raisedForRealtime: Array<\{ itemId: number; quantity: Prisma\.Decimal \}> = \[\]/);
  assert.match(service, /if \(!execution\.replayed\) this\.announceDeficits\(deficits, scope\);/);
  assert.doesNotMatch(service, /applyStockDeltas\([^)]*\)[\s\S]{0,80}emitSync\(/,
    'the announcement must not happen inside applyStockDeltas');

  // Every path that can raise a deficit has to announce it.
  // The helper plus every write path that can raise a deficit: createMany (and
  // so createOne), the stocktaking variance, updateById, deleteMany and
  // createStockAdjustment. updateById matters most here: correcting a covered
  // movement into an over-issue raises a deficit with no other chance to tell
  // anybody.
  const announcing = (service.match(/announceDeficits\(/g) || []).length;
  assert.equal(announcing, 6,
    `expected the helper plus five write paths, found ${announcing}`);
});

test('the queue is reachable, and the alert has a listener', () => {
  // DEF-001 was accepted with no screen and no subscriber. The backend half was
  // complete and the feature was unusable: an operator could not open the queue
  // and the realtime event went to a socket nobody was listening on. A contract
  // cannot prove a screen works, but it can prove the screen still exists and is
  // wired to the event, which is exactly what was missing.
  const client = read('frontend/src/services/stockDeficitApi.ts');
  assert.match(client, /export const stockDeficitApi/);
  assert.match(client, /writeOff/);
  assert.match(client, /Idempotency-Key/,
    'resolving an alert is a state change and must be idempotent');

  const queue = read('frontend/src/pages/stocktaking/StockDeficitQueue.tsx');
  assert.match(queue, /data-testid="stock-deficit-queue"/);
  assert.match(queue, /useRealtimeSyncStore/,
    'the queue must subscribe, or the alert is emitted into a void');
  assert.match(queue, /stock\.deficit-recorded/);
  assert.match(queue, /toast\.warning/,
    'a new shortfall must be announced, not only stored');
  // Writing off a debt is the one action that closes it without a movement, so
  // it must be behind its own permission and demand a reason.
  assert.match(queue, /can\.resolveStockDeficits/);
  assert.match(queue, /reason\.length < 10/);

  // It has to be mounted in a route an operator can actually reach.
  const page = read('frontend/src/pages/StocktakingView.tsx');
  assert.match(page, /import StockDeficitQueue/);
  assert.match(page, /deficits-tab/);
  assert.match(page, /<StockDeficitQueue \/>/);

  // The permission must be in the frontend catalog, or the button never renders.
  assert.match(read('frontend/src/hooks/usePermissions.ts'), /viewStockDeficits/);
  assert.match(read('frontend/src/hooks/usePermissions.ts'), /resolveStockDeficits/);

  // And there has to be a test that drives the screen, because an API-only test
  // is what let the missing screen through in the first place.
  assert.match(read('tests/e2e/def-001-deficit-ui.spec.ts'), /deficits-tab/);
});
