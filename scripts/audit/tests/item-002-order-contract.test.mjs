import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

/**
 * The save button must be wired to an endpoint, and the endpoint must be covered
 * by a test that runs.
 *
 * The button "حفظ ترتيب الأصناف" shipped as a two-line Zustand action. It set
 * `sortMode` and `manualOrder` in memory, issued no request, wrote no
 * localStorage, and had no column, route, DTO, permission or test behind it. The
 * user was told their order was saved; it died on reload. Nothing caught it
 * because no guard read the handler's body and nothing executed it.
 *
 * Two checks, because either alone is satisfiable by a lie:
 *   1. the frontend's save path reaches a call that hits the reorder endpoint
 *   2. the endpoint exists, is guarded by a real permission, and is written by a
 *      spec a package.json script can actually run
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the save-order button reaches the reorder endpoint', () => {
  const catalog = stripComments(read('frontend/src/pages/items/ItemsSmartCatalog.tsx'));
  const page = stripComments(read('frontend/src/pages/items/ItemsPageContent.tsx'));
  const store = stripComments(read('frontend/src/store/useInventoryStore.ts'));
  const service = stripComments(read('frontend/src/services/itemsService.ts'));

  assert.match(
    catalog,
    /حفظ ترتيب الأصناف/,
    'the button this file is named after must still exist, or this guard is describing a fiction',
  );
  assert.match(catalog, /onLockOrder|onSaveOrder/, 'the button must call a save handler');

  // The handler is a prop, so the wiring has to be followed one hop: the page
  // passes a function, and that function must call the store action.
  const handler = page.slice(page.indexOf('onLockOrder='), page.indexOf('onLockOrder=') + 300);
  assert.ok(handler, 'ItemsPageContent must pass a handler to the catalog');
  assert.match(
    handler,
    /saveItemOrder|lockCurrentItemOrder/,
    'the prop must be bound to a store action',
  );

  // And the action must actually persist, not just set local state. The
  // implementation is matched specifically, because the type declaration has the
  // same name and matching that would prove nothing.
  assert.match(
    store,
    /saveItemOrder:\s*async[\s\S]{0,1500}?reorderItems\(/,
    'the save action must call reorderItems; setting a Zustand field is not saving',
  );
  const implementation = store.slice(store.indexOf('saveItemOrder: async'));
  assert.doesNotMatch(
    implementation.slice(0, 600),
    /set\(\{\s*sortMode[^}]*\}\);\s*\}\s*,/,
    'the save action may end by only switching the local sort mode',
  );
  assert.match(
    implementation.slice(0, 1500),
    /toast\.(success|error)/,
    'saving must say whether it worked; a silent save cannot be told from a no-op',
  );

  assert.match(
    service,
    /reorderItems[\s\S]{0,400}?['"`]\/items\/reorder['"`]/,
    'the frontend service must define a call to POST /items/reorder',
  );
});

test('the reorder endpoint exists, is gated, and is exercised by a runnable spec', () => {
  const controller = read('backend/src/item/item.controller.ts');
  const catalog = read('backend/src/auth/permission-catalog.ts');
  const permissions = read('backend/src/auth/permission-catalog.ts');

  assert.match(controller, /@Post\('reorder'\)/, 'the reorder route must exist');
  assert.match(
    controller,
    /@Permissions\('items\.reorder'\)[\s\S]{0,80}@Post\('reorder'\)/,
    'the route must carry a permission; an ungated catalog order is a global setting by accident',
  );
  assert.match(
    permissions,
    /id: 'items\.reorder'/,
    'items.reorder must be in the catalog, or RbacGuard refuses everyone including the right people',
  );
  assert.match(permissions, /POST \/items\/reorder/, 'the catalog entry names the route it guards');

  // The permission must be a human-facing one. `items.sync` is apiOnly, and
  // using a machine permission as a UI gate is how a sync permission ends up
  // meaning "this person may rearrange the catalog".
  const entry = permissions.slice(permissions.indexOf("id: 'items.reorder'"));
  const line = entry.slice(0, entry.indexOf('\n'));
  assert.doesNotMatch(line, /apiOnly/, 'items.reorder gates a button, so it cannot be apiOnly');

  // And a test that runs, because a test nothing invokes is a comment.
  const pkg = JSON.parse(read('package.json'));
  const script = Object.entries(pkg.scripts || {}).find(([, value]) =>
    String(value).includes('tests/e2e/items-order.spec.ts'),
  );
  assert.ok(script, 'no npm script runs tests/e2e/items-order.spec.ts');
  assert.ok(
    existsSync(join(repoRoot, 'tests/e2e/items-order.spec.ts')),
    'the script points at a spec that does not exist',
  );
});

test('the saved order is stored in a column the read path uses', () => {
  const schema = read('backend/prisma/schema.prisma');
  const service = stripComments(read('backend/src/item/item.service.ts'));

  const item = schema.slice(schema.indexOf('model Item {'));
  assert.match(
    item.slice(0, item.indexOf('\n}')),
    /sortOrder\s+Int/,
    'Item has no sortOrder column, so the order has nowhere to live',
  );
  assert.match(item, /@@index\(\[sortOrder\]\)/, 'the read path orders by it, so it needs an index');

  // A column nobody reads is the same as no column.
  assert.match(
    service,
    /orderBy:\s*\[\{\s*sortOrder/,
    'the item read path must order by the saved rank, or the order is stored and never returned',
  );
  assert.match(
    service,
    /sortOrder:\s*true/,
    'responseSelect must carry sortOrder, or the client cannot see the rank it saved',
  );
});

test('a save that cannot resolve an id refuses instead of dropping it', () => {
  const service = stripComments(read('backend/src/item/item.service.ts'));
  const method = service.slice(service.indexOf('async reorderItems'));
  const body = method.slice(0, method.indexOf('\n  async '));

  assert.match(
    body,
    /ITEM_ORDER_UNKNOWN_IDS/,
    'an unresolvable id must be a named refusal',
  );
  assert.ok(
    body.indexOf('unknown') < body.indexOf('UPDATE'),
    'the refusal has to happen before anything is written; checking afterwards still half-saves',
  );
});
