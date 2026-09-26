import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('storage inventory classifies business, queue, legacy, secret, and presentation state', () => {
  const inventory = read('frontend/src/services/storageOwnership.ts');
  for (const ownership of ['BUSINESS_SERVER', 'PRESENTATION_PREFERENCE', 'OFFLINE_QUEUE', 'LEGACY_UNSUPPORTED', 'SECRET_FORBIDDEN']) {
    assert.match(inventory, new RegExp(ownership));
  }
  for (const key of [
    'feed_factory_transactions',
    'feed_factory_partners',
    'feed_factory_orders',
    'feed_factory_monthly_stocktaking_sessions',
    'FeedFactoryMutationDB',
    'feed_factory_unloading_rules',
    'feed_factory_auth_credentials',
    'feed_factory_audit_logs',
    'ff_theme_preference_v1',
  ]) {
    assert.match(inventory, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('unregistered browser storage keys fail closed', () => {
  const inventory = read('frontend/src/services/storageOwnership.ts');
  const storage = read('frontend/src/services/storage.ts');
  assert.match(inventory, /assertStorageKeyAllowed/);
  assert.match(inventory, /STORAGE_KEY_NOT_REGISTERED/);
  assert.match(storage, /assertStorageKeyAllowed\(key, 'localStorage'\)/);
});

test('storage ADR makes server ownership and secret prohibition explicit', () => {
  const adr = read('.hermes/adr/0001-browser-storage-ownership.md');
  const plan = read('.hermes/plans/2026-09-24_mzs-erp-remediation-plan.md');
  assert.match(adr, /BUSINESS_SERVER/);
  assert.match(adr, /stocktaking.*partners.*orders/is);
  assert.match(adr, /Passwords, JWTs, credential hashes, reset codes, OTP challenges, session identifiers, and audit evidence/);
  assert.match(adr, /legacy data/i);
  assert.match(plan, /FC-FND-002/);
  assert.match(plan, /guard test/i);
});
