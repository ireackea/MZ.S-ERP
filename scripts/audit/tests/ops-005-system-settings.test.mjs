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
  assert.match(iam, /await saveSystemSettings\(form, meta, reason\)/);
  // Wide enough for the conflict branch that now precedes the generic failure report:
  // a 409 has to say "somebody else saved" rather than fall through to a bare 400.
  assert.match(iam, /catch \(error: any\)[\s\S]{0,600}toast\.error/);
  // `void … .then()` rather than `await`: the load must not block first paint, and the
  // operator sees a loading state instead of an empty form pretending to be an answer.
  assert.match(iam, /loadSystemSettings\(\)/, 'the form must open on the server, not on a default');
  // …and the server's answer must actually reach the form. This is the assertion whose
  // letter the array/object mismatch satisfied while the value never arrived.
  assert.match(iam, /setForm\(\(current\) =>/);
  assert.match(iam, /snapshot\.form/);
  // The form is refreshed from the server's own answer, so a value the server coerced
  // is what the screen shows.
  assert.match(iam, /setBaseline\(\(current\) => \(\{ \.\.\.current, \.\.\.snapshot\.form \}\)\)/);
});

test('gate 2.1 the reader handles the shape the server actually returns', () => {
  // The second, quieter failure of the same shape: `getAll` returns `settings` as an
  // ARRAY, the reader indexed it as an object, so `settings['company.name']` was
  // `undefined` for every key and the load returned `{}`. The form kept the empty
  // client-side defaults and the required-field guard then refused the save before a
  // request was sent — so a screen with a server behind it could not save anything.
  //
  // Every assertion in this file is a source-text match, which is why that survived:
  // the code satisfied all of them while provably doing nothing. The behaviour is
  // covered by `frontend/src/services/systemSettingsApi.test.ts`, which was verified to
  // fail when this defect is reintroduced. What is asserted here is the two decisions
  // that stop it recurring: normalise both shapes, and refuse anything else loudly
  // instead of returning an empty form.
  assert.match(api, /if \(Array\.isArray\(raw\)\)/, 'the array shape must be handled explicitly');
  assert.match(api, /typeof raw === 'object'/, 'a keyed-object shape must be tolerated too');
  assert.match(
    api,
    /SETTINGS_SHAPE_UNRECOGNISED/,
    'an unknown shape must be an error, never a silently empty form',
  );
  assert.doesNotMatch(
    api,
    /settings\?\.\[binding\.settingKey\]/,
    'indexing the payload by key is the exact expression that read undefined on an array',
  );
});

test('every catalogue key has a form binding, and every binding a catalogue key', () => {
  // The two lists are a duplicated authority until something checks them. A key added
  // server-side with no binding is a setting nobody can edit; a binding for a key that
  // is not in the catalogue is a write the server refuses at runtime.
  const catalogueKeys = [...service.matchAll(/key: '([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]);
  const bindingKeys = [...api.matchAll(/settingKey: '([a-z]+\.[A-Za-z]+)'/g)].map((m) => m[1]);

  assert.ok(catalogueKeys.length > 0, 'the catalogue must not parse as empty');
  assert.deepEqual(
    bindingKeys.slice().sort(),
    catalogueKeys.slice().sort(),
    'the frontend bindings and the backend catalogue have drifted apart',
  );

  // And every one of them must be reachable: a key that is declared but can never be
  // written is a place values go to be lost.
  assert.match(service, /requireDefinition/, 'an unknown key must be refused');
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
  // prop object, including one that carried no change. That comparison against the last
  // prop values was `sameSettings` + a `synced` ref; it is now a `baseline` holding what
  // the server last answered, because the prop is the *client default* — empty for every
  // field — and comparing against it would have reset the form to blank values the
  // moment the parent re-rendered.
  assert.match(iam, /baseline/);
  assert.match(iam, /const dirty = useMemo/);
  assert.doesNotMatch(iam, /setForm\(settings\)\s*;\s*\}\s*,\s*\[settings\]\)/);

  // And the values the server sent must not overwrite what is being typed while the
  // request is still in flight — that window is where keystrokes used to vanish.
  assert.match(iam, /touchedFields/);
});
