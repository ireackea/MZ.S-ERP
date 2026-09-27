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

test('FC-SEC-013 — role definition is SuperAdmin-only, role assignment is permission-gated', () => {
  const service = read('backend/src/users/users.service.ts');

  // Editing what a role can do is role management and stays SuperAdmin-only.
  assert.match(service, /private assertSuperAdmin/);
  for (const method of ['async createRole', 'async updateRolePermissions', 'async deleteRole']) {
    const start = service.indexOf(method);
    assert.notEqual(start, -1, `${method} must exist`);
    const body = service.slice(start, service.indexOf('\n  async ', start + 10) || undefined);
    assert.match(body, /this\.assertSuperAdmin\(actor\)/, `${method} must stay SuperAdmin-only`);
  }

  // Assigning a role to a user is user management, gated by users.create /
  // users.update, with the two rules that actually protect the system in place
  // of the blanket SuperAdmin requirement that made an Admin's grant inert.
  assert.match(service, /private async assertRoleSelection/);
  assert.match(service, /You cannot change your own role\./);
  assert.match(service, /Only SuperAdmin can grant the SuperAdmin role\./);
  assert.match(service, /await this\.assertRoleSelection\(dto, actor, id\)/);
  assert.doesNotMatch(
    service,
    /assertRoleSelection\([\s\S]{0,200}this\.assertSuperAdmin\(actor\)/,
    'role selection must not fall back to the blanket SuperAdmin check',
  );
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
