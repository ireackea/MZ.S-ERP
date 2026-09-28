import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * A named order is a promise that an arrangement can be kept and come back to.
 *
 * Three ways that promise breaks quietly, all of which this guards:
 *
 * - **Two active orders.** The catalogue then has two answers to "what order is
 *   this?" and no screen says which one it is showing.
 * - **A profile marked active while the catalogue holds another order.** The
 *   read paths follow the column, so the saved order and what everyone sees
 *   disagree, and the operator's arrangement is in a table nothing renders.
 * - **An audit row that is written but not awaited.** Prisma queues it, the
 *   transaction callback returns, and the row is never created — so the action
 *   happened and there is no record of it. That one is real: it shipped, and the
 *   test that now exists is what caught it.
 */

test('exactly one saved order can be active, enforced by the database', () => {
  const schema = read('backend/prisma/schema.prisma');
  assert.match(
    schema,
    /model ItemOrderProfile \{[\s\S]*?isActive\s+Boolean/,
    'the profile must carry an active flag',
  );

  const migrations = readdirMigrations();
  const profileMigration = migrations.find((sql) => sql.includes('ItemOrderProfile'));
  assert.ok(profileMigration, 'the profile tables must be created by a migration');

  // A partial unique index, not application code. Two operators clicking "apply"
  // at the same moment can interleave between a read and a write, so a check in
  // the service is a statement of intent and the index is the guarantee.
  assert.match(
    profileMigration,
    /CREATE UNIQUE INDEX[\s\S]*?ItemOrderProfile[\s\S]*?WHERE\s+"?isActive"?\s*=\s*true/i,
    'one active order must be a database constraint, not a check in a service that two requests can interleave',
  );
});

test('the saved order and the catalogue are written in one transaction', () => {
  const service = stripComments(read('backend/src/item/item-order-profile.service.ts'));

  // Every write of a profile must be inside a transaction, because "marked active"
  // and "materialised into Item.sortOrder" are one fact, not two.
  const methods = ['create(', 'apply(', 'refresh(', 'rename(', 'remove('];
  for (const method of methods) {
    const at = service.indexOf(`async ${method}`);
    if (at === -1) continue;
    const body = service.slice(at, service.indexOf('\n  }', at));
    assert.match(
      body,
      /\$transaction\(/,
      `${method} must write inside a transaction; a profile and the catalogue order it claims to be must commit together`,
    );
  }

  // And the materialisation is the same transaction, not a follow-up call.
  assert.match(
    service,
    /await this\.materialise\(tx,/,
    'applying a saved order must write Item.sortOrder on the transaction client',
  );
});

test('every saved-order action is awaited before the transaction commits', () => {
  const service = stripComments(read('backend/src/item/item-order-profile.service.ts'));
  const calls = service.match(/(await )?this\.audit\(/g) || [];

  assert.ok(calls.length >= 4, `expected the profile actions to be audited, found ${calls.length}`);
  const unawaited = calls.filter((call) => !call.startsWith('await '));

  // This is the bug this assertion exists for. `this.audit(tx, ...)` without
  // await queues the write; the transaction callback returns, commits, and the
  // insert never happens. The endpoint returned 201 every time, profiles were
  // created and applied correctly, and audit_logs held nothing.
  assert.deepEqual(
    unawaited,
    [],
    'an unawaited audit write inside $transaction is silently discarded: the record must be awaited',
  );
});

test('the saved orders reach the interface, and drift is shown', () => {
  const component = read('frontend/src/pages/items/ItemOrderProfiles.tsx');

  for (const action of ['تطبيق', 'تحديث']) {
    assert.ok(
      component.includes(action),
      `the saved-orders panel must offer "${action}"; without it an arrangement cannot be kept or put back`,
    );
  }

  // The distinction the whole feature rests on: what is on screen is not what is
  // saved, and the operator has to be able to see that.
  assert.match(
    component,
    /drift/,
    'the panel must show drift between the working order and the saved order',
  );
  assert.match(
    component,
    /profiles === null/,
    'an unloaded list must not render as an empty one, or the operator is told their orders are gone',
  );

  const store = stripComments(read('frontend/src/store/useInventoryStore.ts'));
  for (const action of [
    'loadOrderProfiles',
    'createOrderProfile',
    'applyOrderProfile',
    'refreshOrderProfile',
  ]) {
    assert.match(
      store,
      new RegExp(`${action}:`),
      `the store must expose ${action}`,
    );
  }

  const pkg = JSON.parse(read('package.json'));
  const script = Object.entries(pkg.scripts || {}).find(([, value]) =>
    String(value).includes('tests/e2e/items-order-profile.spec.ts'),
  );
  assert.ok(script, 'no npm script runs the saved-order spec, so nothing will ever execute it');
});

/** Every migration's SQL, in name order. */
function readdirMigrations() {
  const dir = join(repoRoot, 'backend/prisma/migrations');
  return readdirSync(dir)
    // `migration_lock.toml` sits alongside the migration folders and is not one.
    .filter((name) => !name.includes('.'))
    .sort()
    .map((name) => readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
}
