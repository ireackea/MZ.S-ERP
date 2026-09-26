import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const plan = read('.hermes/plans/2026-09-24_mzs-erp-remediation-plan.md');
const board = read('.hermes/plans/STATUS_BOARD.md');
const ledger = read('.hermes/plans/EXECUTION_LEDGER.yaml');
const requiredCards = [
  'FC-FND-001', 'FC-FND-004', 'FC-QA-001', 'FC-FND-002', 'FC-DATA-003',
  'FC-DATA-001', 'FC-INV-001', 'FC-INV-002', 'FC-DATA-002', 'FC-DATA-004',
  'FC-API-001', 'FC-SEC-001', 'FC-SEC-002', 'FC-SEC-003', 'FC-AUD-001',
  'FC-ITEM-001', 'FC-OPS-001', 'FC-API-002', 'FC-REF-001', 'FC-QA-002',
  'FC-CERTIFY-001',
];
const requiredSections = [
  'Full spec', 'Contracts', 'Binding', 'Tests', 'Evidence', 'Done', 'UI:', 'Transport',
];

test('remediation plan contains every planned card and required contract sections', () => {
  const missingCards = requiredCards.filter((card) => !plan.includes(card));
  const missingSections = requiredSections.filter((section) => !plan.includes(section));
  assert.deepEqual(missingCards, []);
  assert.deepEqual(missingSections, []);
});

test('status board exposes every planned card', () => {
  const missingIds = requiredCards
    .map((card) => card.replace(/^FC-/, ''))
    .filter((id) => !board.includes(id));
  assert.deepEqual(missingIds, []);
});

test('execution ledger does not claim an unverified accepted card', () => {
  assert.match(ledger, /mode:\s*autonomous/);
  assert.match(ledger, /completed:\s*0/);
  assert.doesNotMatch(ledger, /FND-001:\s*ACCEPTED/);
  assert.doesNotMatch(ledger, /FND-004:\s*ACCEPTED/);
  assert.doesNotMatch(ledger, /DATA-001:\s*ACCEPTED/);
});
