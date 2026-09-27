// Gate 4 — cross-section integrity. Three modules believed the same thing about
// the same data and each was wrong in its own way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const ruleService = read('backend/src/unloading-rule/unloading-rule.service.ts');
const ruleController = read('backend/src/unloading-rule/unloading-rule.controller.ts');
const txService = read('backend/src/transaction/transaction.service.ts');
const panel = read('frontend/src/modules/settings/components/UnloadingRulesPanel.tsx');
const offline = read('frontend/src/modules/settings/components/OfflineSettings.tsx');
const queue = read('frontend/src/services/mutationQueueService.ts');

/** Source with comments removed, so a guard cannot be satisfied or tripped by prose. */
const codeOf = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

test('gate 4.1 a partial update cannot re-activate a retired rule', () => {
  // `is_active` is @IsOptional, which advertises a partial update, and the service
  // collapsed "not sent" into "active" — so a client PUTting a new penalty rate
  // silently re-enabled a rule an administrator had retired. Deactivation is the
  // only supported way to retire a rule that historical movements still reference.
  const code = codeOf(ruleService);
  assert.doesNotMatch(
    code,
    /isActive:\s*dto\.is_active !== false/,
    'an absent flag must mean "leave it alone", not "true"',
  );
  assert.match(code, /dto\.is_active !== undefined \? \{ isActive: dto\.is_active \} : \{\}/);
});

test('gate 4.2 deactivation is enforced where the rule is used, not where it is listed', () => {
  // findAll filters isActive, so the rule vanishes from every operator's dropdown —
  // but the use site looked it up by id alone. Hiding it in the UI is not
  // enforcing it: a deactivated rule still accepted movements, kept calculating
  // penalties, and became permanently undeletable through the linkage guard.
  const code = codeOf(txService);
  assert.match(code, /select:\s*\{\s*id:\s*true,\s*isActive:\s*true,\s*ruleName:\s*true\s*\}/);
  assert.match(code, /if \(!unloadingRule\.isActive\)/);
  assert.match(code, /is deactivated and cannot be applied to a movement/);

  // And the bulk path must not be a way around the single path.
  const bulk = code.slice(code.indexOf('resolveUnloadingRuleIdMap'));
  assert.match(bulk.slice(0, 1200), /const inactive = unloadingRules\.filter\(\(rule\) => !rule\.isActive\)/);
});

test('gate 4.3 the usage count the settings screen trusts is the real one', () => {
  // It was derived from `state.transactions`, which the store loads with no
  // pagination — the server's default page is 500 — and from `state.items`, capped
  // at 1000. Past those, a genuinely referenced value showed "not in use", its
  // Delete button was enabled, and the panel printed a number the operator used to
  // justify the deletion, while a banner above promised the opposite.
  assert.match(ruleService, /async getUsageCounts/);
  assert.match(ruleService, /groupBy\(\{/);
  assert.match(ruleController, /@Get\('usage-counts'\)/);
  assert.match(panel, /\/unloading-rules\/usage-counts/);

  // An absent count is not a zero, and a zero is what enables the button.
  const code = codeOf(panel);
  assert.doesNotMatch(code, /const usage = usageByRuleId\.get\(String\(rule\.id\)\) \|\| 0/);
  assert.match(code, /if \(reported === undefined\)/);
});

test('gate 4.7 a refused mutation is not retried forever', () => {
  // `blocked` is set on 401/403 — the deactivated or narrowed case. Three paths put
  // it back to pending: the settings retry button, and resumeOwner, which ran on
  // every login. So a user returning to work got a fresh refusal automatically and
  // the offline counters never reached zero.
  const code = codeOf(queue);
  assert.match(code, /\['failed', 'conflict', 'dead-letter'\]\.includes\(task\.status\)/);
  assert.doesNotMatch(
    code,
    /\['failed', 'conflict', 'dead-letter', 'blocked'\]\.includes\(task\.status\)/,
    'retrying a refused mutation cannot succeed',
  );
  // resumeOwner resumed nothing, deliberately and visibly.
  const resume = code.slice(code.indexOf('async resumeOwner'));
  assert.match(resume.slice(0, 1200), /\.filter\(\(\) => false\)/);
  assert.match(queue, /Gate 4\.7: nothing is resumed/);
});

test('gate 4.7 the offline panel reports the failure it has, not another one', () => {
  // It rendered the inventory store's global load error — a failed items fetch —
  // under sync-alert wording, and claimed "no sync errors" while dead-lettered
  // tasks were sitting there with a reason attached.
  const code = codeOf(offline);
  assert.match(code, /const loadError = useInventoryStore/);
  assert.doesNotMatch(code, /\{error \|\|/);
  assert.doesNotMatch(code, /لا توجد أخطاء مزامنة حالية/);
});
