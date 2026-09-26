import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('RBAC denies protected routes without authorization metadata', () => {
  const guard = read('backend/src/auth/rbac.guard.ts');
  assert.match(guard, /ALLOW_AUTHENTICATED_METADATA_KEY/);
  assert.match(guard, /Route authorization metadata is required/);
  assert.doesNotMatch(guard, /if \(!requiredPermissions\.length && !requiredRoles\.length\) return true/);
});

test('role management is SuperAdmin-only at the service boundary', () => {
  const service = read('backend/src/users/users.service.ts');
  assert.match(service, /private assertSuperAdmin/);
  assert.match(service, /private assertRoleSelection/);
  assert.match(service, /this\.assertSuperAdmin\(actor\)/);
  assert.match(service, /this\.assertRoleSelection\(dto, actor\)/);
});

test('transaction mutations require request idempotency', () => {
  const controller = read('backend/src/transaction/transaction.controller.ts');
  const service = read('backend/src/transaction/transaction.service.ts');
  const schema = read('backend/prisma/schema.prisma');
  const migration = read('backend/prisma/migrations/20260925090000_add_idempotency_records/migration.sql');
  assert.match(controller, /Headers\('idempotency-key'\)/);
  assert.match(service, /executeIdempotently/);
  assert.match(service, /Serializable/);
  assert.match(schema, /model IdempotencyRecord/);
  assert.match(migration, /CREATE UNIQUE INDEX "idempotency_records_actorId_operation_key_key"/);
});

test('offline queue is owner-bound and service worker cannot replay it', () => {
  const queue = read('frontend/src/services/mutationQueueService.ts');
  const sync = read('frontend/src/hooks/useOfflineSync.ts');
  const worker = read('frontend/public/sw.js');
  const app = read('frontend/src/App.tsx');
  const permissions = read('frontend/src/hooks/usePermissions.ts');
  assert.match(queue, /ownerUserId/);
  assert.match(queue, /quarantineOwner/);
  assert.match(queue, /['"]conflict['"]/);
  assert.match(sync, /mutationQueueService\.quarantineOwner/);
  assert.doesNotMatch(worker, /DYNAMIC_CACHE/);
  assert.doesNotMatch(worker, /processMutationQueue/);
  assert.doesNotMatch(app, /ROLE_BASED_FALLBACK_PERMISSIONS|resolveRoleFallbackPermissions/);
  assert.doesNotMatch(permissions, /ROLE_BASED_FALLBACK_PERMISSIONS|resolveRoleFallbackPermissions/);
});

test('PDF rendering is bounded and blocks external requests', () => {
  const dto = read('backend/src/report/dto/print-report.dto.ts');
  const service = read('backend/src/report/report.service.ts');
  assert.match(dto, /@MaxLength\(2_000_000\)/);
  assert.match(service, /setRequestInterception\(true\)/);
  assert.match(service, /TOO_MANY_REQUESTS/);
  assert.match(service, /%PDF-/);
});

test('CI has mandatory typecheck, audit, test, build, and compose gates', () => {
  // FC-QA-001 consolidated the gate list into `npm run ci:verify`, so the
  // workflow delegates instead of repeating the steps. The gate list itself is
  // now asserted in scripts/audit/tests/qa-001-contract.test.mjs; this test
  // keeps the same guarantee from the security angle: the verify workflow must
  // call the shared gate, and nothing may soften a failure.
  const workflow = read('.github/workflows/main.yml');
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.match(workflow, /npm run ci:verify/,
    'the push/pull_request workflow must run the shared verify gate');
  assert.match(scripts['ci:verify'], /typecheck/);
  assert.match(scripts['ci:verify'], /test:audit/);
  assert.match(scripts['ci:verify'], /test:unit/);
  assert.match(scripts['ci:verify'], /build:full/);
  assert.match(scripts['ci:verify'], /compose config/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});
