import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('offline queue records durability and replay fields', () => {
  const queue = read('frontend/src/services/mutationQueueService.ts');
  for (const field of ['idempotencyKey', 'entity', 'operation', 'payloadVersion', 'attempts', 'nextRetryAt', 'lastError', 'createdAt']) {
    assert.match(queue, new RegExp(field));
  }
  assert.match(queue, /dead-letter/);
  assert.match(queue, /MAX_MUTATION_ATTEMPTS/);
  assert.match(queue, /calculateRetryDelay/);
  assert.match(queue, /resumeOwner/);
  assert.match(queue, /retryOwner/);
  assert.match(queue, /MUTATION_QUEUE_QUOTA_EXCEEDED/);
});

test('offline sync exposes queue states and manual retry', () => {
  const hook = read('frontend/src/hooks/useOfflineSync.ts');
  for (const state of ['conflictCount', 'failedCount', 'deadLetterCount']) {
    assert.match(hook, new RegExp(state));
  }
  assert.match(hook, /retryFailed/);
  assert.match(hook, /resumeOwner/);
  assert.match(hook, /FEED_FACTORY_QUEUE_REPLAY/);
});

test('service worker never caches authenticated API traffic', () => {
  const worker = read('frontend/public/sw.js');
  assert.match(worker, /url\.pathname\.startsWith\('\/api'\)/);
  assert.match(worker, /fetch\(event\.request\)/);
  assert.match(worker, /FEED_FACTORY_QUEUE_REPLAY/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request, copy\)[\s\S]*url\.pathname\.startsWith\('\/api'\)/);
});

test('storage ownership keeps the mutation queue offline-only', () => {
  const inventory = read('frontend/src/services/storageOwnership.ts');
  assert.match(inventory, /FeedFactoryMutationDB.*OFFLINE_QUEUE/s);
  assert.match(inventory, /mutationQueue.*OFFLINE_QUEUE/s);
});
