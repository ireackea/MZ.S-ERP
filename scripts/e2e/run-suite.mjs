#!/usr/bin/env node
// FC-ITEM-IMPORT — one command that runs every backend-only end-to-end spec, in
// order, with enough auth headroom that the suite can actually finish.
//
// Two problems it solves, both of which made the E2E column a fiction.
//
// 1. Twelve of the twenty-eight specs in tests/e2e were wired to no CI step at
//    all, including `items-order-import.spec.ts` — the only spec that exercises
//    POST /items/import-excel. A hand-maintained list of `npm run test:e2e:*`
//    lines in a workflow is a list that silently stops covering things, and this
//    file discovered them by reading the directory instead. A new spec is now
//    covered the moment it is written.
//
// 2. The login budget is 20 attempts per 15 minutes keyed by client IP, which is
//    the right number for stopping a human guessing a password and the wrong
//    number for a suite that logs in once per `it`. Every spec from one CI runner
//    shares one IP, so the suite would exhaust the bucket partway through and the
//    remaining specs would fail on 429 rather than on anything they assert.
//
//    The fix is not to raise the budget. `POST /auth/reset-attempts` is exempt
//    from the limiter, a session may reset its own attempts, and it calls
//    `resetGlobalRateLimit`, which clears exactly the `auth:<ip>` bucket. So this
//    runner signs in once, immediately clears the bucket with that session, and
//    every spec afterwards starts with a full budget. An attacker without a valid
//    session still cannot reset anything, so the brute-force ceiling is intact.
//
// Specs that need a browser or a scratch database are deliberately not run here;
// each one is listed below with the reason and the script that owns it. Folding
// them in silently would produce failures that look like product defects.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const e2eDir = join(repoRoot, 'tests', 'e2e');

const backendUrl =
  String(process.env.E2E_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const username = String(process.env.E2E_USERNAME || 'superadmin').trim();
const password = String(process.env.E2E_PASSWORD || 'SecurePassword2026!');

// Excluded, with the reason and the script that runs it instead.
const EXCLUDED = new Map([
  [
    'reset-success.spec.ts',
    'needs its own scratch database (mzs_reset_sandbox) and a second API on port 3199',
  ],
  [
    'reset-delete-order.spec.ts',
    'destructive: it exercises the system reset, which is not something a suite runner should fire repeatedly',
  ],
  ['phase3-visual-proof.spec.ts', 'drives a real browser against a served frontend'],
  ['qa-002-offline.spec.ts', 'drives a real browser and a service worker'],
  ['def-001-deficit-ui.spec.ts', 'drives a real browser'],
  ['backup-dashboard.spec.ts', 'drives a real browser'],
  ['full-system.spec.ts', 'drives a real browser'],
  ['offline-queue.spec.ts', 'asserts browser-side offline behaviour'],
  ['settings-regression.spec.ts', 'drives a real browser'],
]);

const listSpecs = () => {
  const all = readdirSync(e2eDir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();

  const included = [];
  const skipped = [];
  for (const name of all) {
    const reason = EXCLUDED.get(name);
    if (reason) skipped.push({ name, reason });
    else included.push(name);
  }
  return { included, skipped };
};

/**
 * Sign in once, then clear the auth bucket with that session.
 *
 * Deliberately tolerant: if the backend is not up yet, or the credentials are
 * wrong, this reports it and returns false rather than throwing. The specs will
 * fail with a clear message of their own, and a runner that hides the specs'
 * output behind its own stack trace is worse than no runner.
 *
 * This runs before *every* spec, not once for the suite. One warm-up for the
 * whole run is not enough: the budget is twenty logins per fifteen minutes for the
 * whole client address, `items-order.spec.ts` alone uses seven, and a suite of
 * seven files reaches the ceiling mid-run and starts failing on 429 rather than on
 * anything it asserts. A per-file warm-up costs one extra login and makes the
 * ceiling per file instead of per run, which is the only shape that scales.
 */
const ensureAuthHeadroom = () => {
  let cookie = '';
  // Declared outside the try on purpose. It was inside, so the error path below —
  // which is the path that runs when the login itself failed, i.e. exactly when
  // somebody is looking for an explanation — threw `ReferenceError: login is not
  // defined` and took the whole suite down with it. A failure handler that cannot
  // run is worse than no failure handler, because it replaces a diagnosis with a
  // crash.
  let login = { stdout: '', stderr: '' };
  try {
    login = spawnSync(
      'node',
      [
        '-e',
        `
        const login = async () => {
          const response = await fetch(${JSON.stringify(`${backendUrl}/api/auth/login`)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: process.argv[1], password: process.argv[2] }),
          });
          if (!response.ok) {
            console.error('login returned ' + response.status);
            process.exit(2);
          }
          const cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
          if (!cookie.includes('feed_factory_jwt=')) {
            console.error('login returned no session cookie');
            process.exit(2);
          }
          // The whole point: clear auth:<ip> using this session. The endpoint is
          // exempt from the limiter and allows self-reset.
          const reset = await fetch(${JSON.stringify(`${backendUrl}/api/auth/reset-attempts`)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ username: process.argv[1] }),
          });
          if (!reset.ok) {
            console.error('reset-attempts returned ' + reset.status);
            process.exit(3);
          }
          console.log('ok');
        };
        login().catch((error) => { console.error(String(error)); process.exit(1); });
        `,
        username,
        password,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    cookie = String(login.stdout || '').trim();
  } catch (error) {
    console.error(`auth warmup threw: ${error instanceof Error ? error.message : String(error)}`);
  }

    if (cookie === 'ok') return true;
  const detail = [login?.stdout, login?.stderr].filter(Boolean).join(' ').trim();
  const exhausted = /429/.test(detail);
  console.error(
    `auth warmup did not complete${detail ? `: ${detail}` : ''}. ` +
      'The specs will most likely fail on 429 or on login. Check that the backend is up and that ' +
      'E2E_USERNAME/E2E_PASSWORD are correct.',
  );
  if (exhausted) {
    // Worth spelling out, because it is a real property of the product and not a
    // test-harness inconvenience: `POST /auth/reset-attempts` is exempt from the
    // limiter, but it requires a valid session — so a caller who has exhausted the
    // twenty-login budget cannot reset it and must wait for the window. The warmup
    // can only help when the bucket is not already full, which is why this path
    // exists at all.
    console.error(
      'The login budget for this address is exhausted, and the warmup cannot clear it: clearing ' +
        'requires a session, and getting a session is what is being refused. Restart the backend ' +
        '(the limiter holds its counters in memory) or wait for the window to pass.',
    );
  }
  return false;
}
;

const runSpec = (name) => {
  const started = Date.now();
  const result = spawnSync('npm', ['exec', 'vitest', '--', '--run', join('tests', 'e2e', name)], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    timeout: 20 * 60_000,
  });
  return { name, ok: result.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
};

const { included, skipped } = listSpecs();

console.log(`e2e suite: ${included.length} spec(s) against ${backendUrl}`);
if (skipped.length) {
  console.log('e2e suite: not run here —');
  for (const { name, reason } of skipped) console.log(`  - ${name}: ${reason}`);
}

const continueOnFailure = process.argv.includes('--continue');
const only = process.argv.filter((arg) => arg.endsWith('.spec.ts'));
const selected = only.length ? included.filter((name) => only.includes(name)) : included;

if (selected.length === 0) {
  console.error('e2e suite: no spec matched. Nothing ran.');
  process.exit(1);
}

ensureAuthHeadroom();

const results = [];
for (const name of selected) {
  console.log(`\n=== e2e: ${name} ===`);
  // Per file, not per run: see the note on ensureAuthHeadroom.
  ensureAuthHeadroom();
  const outcome = runSpec(name);
  results.push(outcome);
  if (!outcome.ok && !continueOnFailure) {
    console.error(`\ne2e suite: ${name} failed after ${outcome.seconds}s. Stopping.`);
    break;
  }
}

console.log('\n=== e2e summary ===');
for (const outcome of results) {
  console.log(`  ${outcome.ok ? 'pass' : 'FAIL'}  ${outcome.name}  (${outcome.seconds}s)`);
}
const failed = results.filter((outcome) => !outcome.ok);
const notRun = selected.length - results.length;

if (notRun > 0) console.log(`  ${notRun} spec(s) not reached.`);
console.log(`  ${results.length - failed.length}/${results.length} passed.`);

if (failed.length > 0) {
  console.error(`e2e suite: ${failed.map((outcome) => relative('tests/e2e', outcome.name)).join(', ')} failed.`);
  process.exit(1);
}
process.exit(0);
