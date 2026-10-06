// Gate 2.1 — the settings screen had no server, and the first server it got had
// no authentication.
//
// Two defects of the same shape: a feature that was missing, and a feature that
// was present but open. Both pass a type check and both report success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const controller = readFileSync(join(repoRoot, 'backend/src/system-settings/system-settings.controller.ts'), 'utf8');
const service = readFileSync(join(repoRoot, 'backend/src/system-settings/system-settings.service.ts'), 'utf8');
const migration = readFileSync(
  join(repoRoot, 'backend/prisma/migrations/20260927100000_add_system_settings/migration.sql'),
  'utf8',
);
const schema = readFileSync(join(repoRoot, 'backend/prisma/schema.prisma'), 'utf8');
const iam = readFileSync(join(repoRoot, 'frontend/src/modules/settings/components/GeneralSettings.tsx'), 'utf8');
const api = readFileSync(join(repoRoot, 'frontend/src/services/systemSettingsApi.ts'), 'utf8');

test('gate 2.1 company settings live on the server, with one owner', () => {
  assert.match(schema, /model SystemSetting \{/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "system_settings"/);
  // SET NULL, not CASCADE: deleting a user must not delete the company settings
  // they last edited.
  assert.match(migration, /ON DELETE SET NULL/);

  // An unknown key is refused. Otherwise the table becomes a second, unvalidated
  // settings surface no screen renders — a place values go to be lost, which is
  // what the client-side store already was.
  assert.match(service, /Unknown setting/);
  assert.match(service, /requireDefinition/);

  // The declared type is enforced on write, because a TEXT column cannot.
  // `defaultUnloadingDuration` as "sixty" would otherwise reach the unloading
  // rules as a real, wrong number.
  assert.match(service, /Number\.isFinite\(value\)/, 'NaN must be rejected, not stored');
  assert.match(service, /must not be negative/);
});

test('gate 2.1 the settings endpoint is authenticated, and this is asserted per controller', () => {
  // There is no global guard in this application, so `@Permissions` on its own is
  // inert metadata. This controller shipped once answering 200 on GET and PUT
  // with no session at all.
  assert.match(
    controller,
    /@UseGuards\(JwtAuthGuard, RbacGuard\)/,
    'a controller with only @Permissions is unauthenticated here',
  );
  assert.match(controller, /@Permissions\('settings\.view\.general'\)/);
  assert.match(controller, /@Permissions\('settings\.update\.system'\)/);

  // And the guard is checked across the whole backend, not just this file, so the
  // next controller added without one is caught by the suite.
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.controller.ts')) files.push(full);
    }
  };
  walk(join(repoRoot, 'backend/src'));

  const openControllers = files.filter((file) => {
    const source = readFileSync(file, 'utf8');
    const isPublic = /@Public\(\)/.test(source);
    const hasGuards = /@UseGuards\(/.test(source);
    return !isPublic && !hasGuards;
  });

  assert.deepEqual(
    openControllers.map((file) => file.replace(repoRoot, '.')),
    [],
    'a controller with no @UseGuards and no @Public is unauthenticated in this application',
  );
});

test('gate 2.1 the settings screen reports what the server did', () => {
  // The defect: `onUpdateSettings(form); toast.success(...)` — a client-side write
  // and a success message, on a value printed on every report.
  assert.doesNotMatch(iam, /toast\.success\('تم حفظ الإعدادات العامة بنجاح\.'\)/);
  assert.match(iam, /await saveSystemSettings\(form\)/);
  assert.match(iam, /catch \(error: any\)[\s\S]{0,120}toast\.error/);
  assert.match(iam, /await loadSystemSettings\(\)/, 'the form must open on the server, not on a default');
  // Re-read after saving rather than trusting the form, so a value the server
  // coerced is what the screen shows.
  assert.match(iam, /setForm\(\(current\) => \(\{ \.\.\.current, \.\.\.fresh \}\)\)/);
});

test('gate 2.1 the settings write is attributable', () => {
  assert.match(schema, /updatedById String\?/);
  assert.match(schema, /reason      String\?/);
  assert.match(service, /SYSTEM_SETTINGS_UPDATE/);
  // The message is the part a human reads: which keys moved and what they became.
  assert.match(service, /`\$\{entry\.key\}: \$\{entry\.from/);
});

test('a setting the screen cannot edit must never be written by that screen', () => {
  // The defect this guards: the two operations defaults have no input on this form,
  // but every binding used to be sent on save. With no input to refill them the
  // values arrived as `undefined`, were coerced to 0, and an operator editing the
  // phone number reset the unloading duration to 0 in the same request — while the
  // screen reported success.
  assert.match(api, /editable: false/, 'a binding must be able to declare itself read-only');
  assert.doesNotMatch(
    api,
    /settings: BINDINGS\.map\(/,
    'the request body is built from every binding, read-only keys included',
  );
  assert.match(api, /settings: EDITABLE_BINDINGS\.map\(/);

  // Read-only here is not unused: the daily-operations screen and the statement fall
  // back to these values when no unloading rule matches, so the read must survive.
  assert.match(api, /for \(const binding of BINDINGS\) \{/);

  // And the form must not offer an input it does not own.
  assert.doesNotMatch(iam, /المدة الافتراضية للتفريغ/);
  assert.doesNotMatch(iam, /غرامة التأخير الافتراضية/);
});

test('the values printed on every document cannot be blanked', () => {
  // `defaultValue: ''` for the company name, and a free-text input with no check,
  // meant a cleared field was saved as an empty string and every printed document
  // lost its header — with a success message.
  assert.match(service, /required\?: boolean/);
  assert.match(service, /company\.name'[^\n]*required: true/);
  assert.match(service, /company\.currency'[^\n]*required: true/);
  assert.match(service, /definition\.required && !text\.trim\(\)/);

  // Refused at the boundary and named on screen, so the operator is told which field.
  assert.match(api, /label: string/);
  assert.match(iam, /required/);
});

test('a parent re-render must not discard what the operator typed', () => {
  // `useEffect(() => setForm(settings), [settings])` reset the form on every new
  // prop object, including one that carried no change.
  assert.match(iam, /sameSettings/);
  assert.match(iam, /synced\.current/);
});
