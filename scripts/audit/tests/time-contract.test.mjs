import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('canonical time service owns Cairo business boundaries', () => {
  const service = read('backend/src/common/time/time.service.ts');
  const module = read('backend/src/common/time/time.module.ts');
  const tests = read('backend/src/common/time/time.service.test.ts');
  assert.match(service, /Africa\/Cairo/);
  assert.match(service, /getFinancialYearRange/);
  assert.match(service, /zonedDateTimeToUtc/);
  assert.match(service, /parseDate/);
  assert.match(module, /@Global/);
  assert.match(module, /exports: \[TimeService\]/);
  assert.match(tests, /Cairo business day/);
  assert.match(tests, /financial-year boundaries/);
});

test('business calculations use TimeService instead of local calendar construction', () => {
  const transaction = read('backend/src/transaction/transaction.service.ts');
  const report = read('backend/src/report/report.service.ts');
  const dashboard = read('backend/src/dashboard/dashboard.service.ts');
  const appModule = read('backend/src/app.module.ts');
  assert.match(transaction, /private readonly timeService: TimeService/);
  assert.match(transaction, /timeService\.getFinancialYearRange/);
  assert.doesNotMatch(transaction, /new Date\(\)\.getFullYear\(\)/);
  assert.match(report, /timeService\.parseDate/);
  assert.match(dashboard, /getBusinessDayRange/);
  assert.match(appModule, /TimeModule/);
});
