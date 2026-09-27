import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('scope authority ignores request scope for non-superadmin users', () => {
  const scope = read('backend/src/common/scope.ts');
  assert.match(scope, /role === 'SuperAdmin'/);
  assert.match(scope, /return 'default'/);
  assert.match(scope, /warehouseScopeCondition/);
});

test('transaction routes derive scope from the authenticated principal', () => {
  const controller = read('backend/src/transaction/transaction.controller.ts');
  const service = read('backend/src/transaction/transaction.service.ts');
  assert.match(controller, /resolveWarehouseScope\(req\.user\?\.role\)/);
  assert.match(service, /warehouseScopeCondition\(scope\)/);
  assert.match(service, /scope === 'all'/);
  assert.match(service, /scope === 'all' \? dto\.warehouseId : scope/);
});

test('reports and dashboard aggregates apply the server scope', () => {
  const reportController = read('backend/src/report/report.controller.ts');
  const reportService = read('backend/src/report/report.service.ts');
  const dashboardController = read('backend/src/dashboard/dashboard.controller.ts');
  const dashboardService = read('backend/src/dashboard/dashboard.service.ts');
  assert.match(reportController, /resolveWarehouseScope\(req\.user\?\.role\)/);
  assert.match(reportService, /warehouseScopeCondition\(scope\)/);
  assert.match(dashboardController, /resolveWarehouseScope\(req\.user\?\.role\)/);
  assert.match(dashboardService, /warehouseScopeCondition\(scope\)/);
});

test('realtime and backup paths have an explicit scope boundary', () => {
  const realtime = read('backend/src/realtime/realtime.gateway.ts');
  const backup = read('backend/src/backup/backup.controller.ts');
  assert.match(realtime, /event\.scope/);
  assert.match(realtime, /SuperAdmin/);
  // FC-SEC-013 — this used to assert `@Roles('Admin','SuperAdmin')` on the backup
  // controller as the boundary proof. The role gate is gone, and it was never the
  // real boundary anyway: a grant an administrator could see and make in the IAM
  // matrix had no effect while it stood. The permission is the boundary.
  assert.match(backup, /@Permissions\('backup\.(restore|delete|create)'\)/);
  assert.doesNotMatch(backup, /@Roles\(/);
});

test('scope tests are part of the executable contract', () => {
  const packageJson = read('package.json');
  assert.match(packageJson, /test:backend:scope/);
});
