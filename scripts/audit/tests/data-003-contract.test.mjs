import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('data ownership schema contains server-backed domain models', () => {
  const schema = read('backend/prisma/schema.prisma');
  for (const model of ['model Partner', 'model Order', 'model OrderItem', 'model StocktakingSession', 'model StocktakingEntry', 'model StocktakingCount']) {
    assert.match(schema, new RegExp(model));
  }
  assert.match(schema, /partnerId/);
  assert.match(schema, /stocktakingEntries/);
  assert.match(schema, /@@unique\(\[monthKey, warehouseId\]\)/);
});

test('partners, orders, and stocktaking expose scoped idempotent APIs', () => {
  const appModule = read('backend/src/app.module.ts');
  const partnersController = read('backend/src/partners/partners.controller.ts');
  const ordersController = read('backend/src/orders/orders.controller.ts');
  const stocktakingController = read('backend/src/stocktaking/stocktaking.controller.ts');
  assert.match(appModule, /PartnersModule/);
  assert.match(appModule, /OrdersModule/);
  assert.match(appModule, /StocktakingModule/);
  for (const source of [partnersController, ordersController, stocktakingController]) {
    assert.match(source, /Permissions|Roles|Headers|scope|idempot/i);
  }
  assert.match(partnersController, /@Controller\('partners'\)/);
  assert.match(ordersController, /@Controller\('orders'\)/);
  assert.match(stocktakingController, /@Controller\('stocktaking'\)/);
  assert.match(stocktakingController, /close/);
});

test('frontend no longer treats stocktaking, partners, or orders as local business stores', () => {
  const app = read('frontend/src/App.tsx');
  const stocktaking = read('frontend/src/services/monthlyStocktakingService.ts');
  const storage = read('frontend/src/services/storage.ts');
  assert.doesNotMatch(app, /getPartners\(|savePartners\(|getOrders\(|saveOrders\(/);
  assert.doesNotMatch(stocktaking, /feed_factory_monthly_stocktaking_sessions/);
  assert.doesNotMatch(storage, /getPartners|savePartners|getOrders|saveOrders/);
  assert.match(app, /partnersApi|ordersApi|stocktakingApi/);
});

test('legacy domain migration has a versioned adapter and idempotency boundary', () => {
  const migration = read('frontend/src/services/domainMigrationService.ts');
  assert.match(migration, /version/i);
  assert.match(migration, /idempotency/i);
  assert.match(migration, /stocktaking|partners|orders/i);
  assert.match(migration, /localStorage/);
});
