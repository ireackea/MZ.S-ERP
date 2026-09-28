// Gate 3.3 / 3.5 / 5.2 / 5.3 / 5.4 — screens that looked like features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
const codeOf = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');

test('gate 3.3 the permissions matrix reads the server, not localStorage', () => {
  const matrix = read('frontend/src/modules/settings/components/PermissionsMatrix.tsx');
  const code = codeOf(matrix);

  // It called getIamConfig(), which reads localStorage['feed_factory_iam_config']
  // and falls back to a hardcoded template naming nine roles that do not exist
  // server-side, with `admin: ['*']` — asserting the admin role is a superuser.
  // The real Admin role holds fourteen wildcards and not admin.reset_system. The
  // one screen an administrator opens to reason about who can do what was fiction,
  // while its sibling UnifiedIAM read the same data from the server.
  assert.doesNotMatch(code, /getIamConfig/);
  assert.match(code, /fetchRoles/);
  assert.match(matrix, /useEffect/);

  // A load failure must not become an empty matrix, which reads as "these roles
  // hold nothing" — the same confident wrong answer for a different reason.
  assert.match(matrix, /if \(!roles\)/);
  assert.match(matrix, /لم تُحمَّل من الخادم/);

  // Gated on the read key; the deny message had claimed a *view* permission while
  // the check was on `users.update`.
  assert.match(code, /hasPermission\('users\.view'\)/);
  assert.doesNotMatch(code, /hasPermission\('users\.update'\)/);
});

test('gate 3.3 the matrix matches through the wildcard-aware helper', () => {
  const code = codeOf(read('frontend/src/modules/settings/components/PermissionsMatrix.tsx'));
  // `role.permissionIds.includes(permission.id)` is false for every permission
  // under an `admin.*` grant, so the matrix reported the admin role as holding
  // nothing and an administrator would "fix" grants that were already effective.
  assert.doesNotMatch(code, /permissionIds\.includes\(permission\.id\)/);
  assert.match(code, /hasGrantedPermission\(role\.permissions \?\? \[\], permission\.id\)/);
});

test('gate 3.5 the printing-templates tab has columns to render', () => {
  const tab = read('frontend/src/modules/settings/components/PrintingTemplates.tsx');
  const page = read('frontend/src/components/OpeningBalancePage.tsx');

  // Both lists were seeded from the store, which holds [], so both rendered zero
  // rows and the Save button reported success while writing an empty list back.
  assert.match(tab, /mergeColumns\(STOCK_CARD_COLUMNS, reportConfig\)/);
  assert.match(tab, /mergeColumns\(OPENING_BALANCE_COLUMNS, openingBalanceReportConfig\)/);

  // One catalogue, two consumers — not a private copy per screen, which is what
  // let the tab start from nothing.
  const columns = read('frontend/src/services/reportColumns.ts');
  assert.match(columns, /export const STOCK_CARD_COLUMNS/);
  assert.match(columns, /export const OPENING_BALANCE_COLUMNS/);
  assert.match(page, /OPENING_BALANCE_COLUMNS/);
  assert.doesNotMatch(page, /const DEFAULT_COLUMNS/, 'the private copy is what let the tab diverge');

  // A screen that writes is not gated on a view key.
  const code = codeOf(tab);
  assert.match(code, /hasPermission\('settings\.update\.system'\)/);
  assert.doesNotMatch(code, /hasPermission\('settings\.view\.general'\)/);
});

test('gate 5.2 the unreferenced components are gone', () => {
  for (const rel of [
    'frontend/src/modules/settings/components/UnloadingRulesSettings.tsx',
    'frontend/src/modules/settings/components/ThemePreviewCard.tsx',
  ]) {
    assert.equal(
      existsSync(join(repoRoot, rel)),
      false,
      `${rel} had no importers; a fix applied to its live counterpart can be silently forked here`,
    );
  }
});

test('gate 5.2 retryTask is scoped to the owner', () => {
  const queue = codeOf(read('frontend/src/services/mutationQueueService.ts'));
  // It looked a task up across every owner, so a call would flip another
  // account's blocked task to pending and sync() would replay it under the current
  // session: that account's mutation, executed with this session's authority.
  const fn = queue.slice(queue.indexOf('async retryTask'));
  assert.match(fn.slice(0, 900), /entry\.ownerUserId === ownerUserId/);
  assert.match(fn.slice(0, 900), /task\.status === 'blocked'/, 'a refused mutation is not retried');
});

test('gate 5.3 the language control is gone, not broken', () => {
  const theme = read('frontend/src/modules/settings/components/ThemeAndLocalization.tsx');
  const code = codeOf(theme);

  // useTranslation appears in zero files and the two translation files hold 79 and
  // 45 bytes, so choosing "English" changed nothing — and the page advertised a
  // working language switch. It also read i18n.language from a module singleton
  // during render with no subscription, so even the dropdown snapped back.
  assert.doesNotMatch(code, /i18n\.changeLanguage/);
  assert.doesNotMatch(code, /<select/);
  // The explanatory paragraph legitimately quotes the old wording in order to say it
  // is no longer true, so the copy itself is not asserted against. What matters is
  // that the control and the claim are gone from the rendered UI: no select, no
  // changeLanguage, and a plain statement that it is unavailable.
  assert.match(code, /تبديل اللغة غير مُفعَّل/);
  assert.doesNotMatch(code, /<option/);
});

test('gate 5.4 the settings strip is a tab widget', () => {
  const page = read('frontend/src/modules/settings/pages/Settings.tsx');
  // Ten sibling buttons carried "which section is open" in a background colour
  // alone, and nothing related a tab to its panel.
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /aria-selected=\{active\}/);
  assert.match(page, /aria-controls=\{`settings-panel-\$\{tab\.key\}`\}/);
  assert.match(page, /role="tabpanel"/);
  assert.match(page, /aria-labelledby=\{`settings-tab-\$\{resolvedActiveTab\}`\}/);
  // Roving tabindex: the strip is one stop, the arrow keys move within it.
  assert.match(page, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(page, /ArrowRight/);
  assert.match(page, /ArrowLeft/);
});

test('the settings page stops telling administrators to grant ids that do not exist', () => {
  const page = read('frontend/src/modules/settings/pages/Settings.tsx');
  // The remediation copy named settings.view.users and settings.view.backup, both
  // removed legacy ids. An administrator following it could not grant access at
  // all — the role write is rejected.
  assert.doesNotMatch(page, /settings\.view\.users/);
  assert.doesNotMatch(page, /settings\.view\.backup/);
  assert.match(page, /users\.view/);
  assert.match(page, /backup\.view/);
});
