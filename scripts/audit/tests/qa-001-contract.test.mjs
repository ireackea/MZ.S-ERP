// FC-QA-001 — one CI contract and a green test gate.
//
// This reads the workflows and the root package.json and fails when CI can go
// green without the tree actually being correct. Every assertion here maps to a
// way the previous CI produced a false green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');
const workflowDir = join(repoRoot, '.github', 'workflows');
const workflows = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
const all = workflows.map((name) => ({ name, text: read(join('.github', 'workflows', name)) }));
const ci = all.filter((w) => w.text.includes('npm run test:audit') || w.name === 'ci.yml');
const pkg = JSON.parse(read('package.json'));
const rootScripts = pkg.scripts || {};

test('the workflow set is small enough to have one contract', () => {
  // Two near-duplicate CI definitions drift, which is how Node 18/20 and
  // missing gates accumulated in the first place.
  assert.ok(workflows.length > 0, 'there must be at least one workflow');
  const verifyJobs = all.filter((w) => /test:audit|ci:verify/.test(w.text));
  assert.ok(verifyJobs.length >= 1, 'no workflow runs the verify gate');
  for (const job of verifyJobs) {
    assert.ok(!/matrix:[\s\S]{0,80}node-version:\s*\[[^\]]*,/.test(job.text),
      `${job.name}: a Node matrix lets the build drift across versions`);
  }
});

test('no workflow pins a Node version outside the declared LTS', () => {
  const declared = String(rootScripts['ci:node'] || process.env.CI_NODE_LTS || '').trim();
  for (const { name, text } of all) {
    for (const match of text.matchAll(/node-version:\s*\[?['"]?([0-9]+)(\.x)?/g)) {
      const major = Number(match[1]);
      assert.ok(major >= 22,
        `${name}: Node ${major} is not an active LTS; the tree targets Node 22`);
      if (declared) {
        assert.equal(String(major), declared.replace(/\D/g, ''),
          `${name}: Node ${major} disagrees with the declared LTS (${declared})`);
      }
    }
    assert.doesNotMatch(text, /node-version:\s*1[68]/,
      `${name}: Node 16/18 is out of support`);
  }
});

test('every workflow uses the same install command', () => {
  const installs = new Set();
  for (const { name, text } of all) {
    for (const match of text.matchAll(/npm (ci|install)[^\n]*/g)) installs.add(match[0].trim());
  }
  assert.equal(installs.size, 1,
    `all workflows must use one install command, found: ${[...installs].join(' | ')}`);
});

test('a failing test can never be reported as a pass', () => {
  for (const { name, text } of all) {
    assert.doesNotMatch(text, /continue-on-error:\s*true/,
      `${name}: continue-on-error turns a failure into a green build`);
    // `|| true` and `; exit 0` are the same lie in shell form.
    assert.doesNotMatch(text, /\|\|\s*true/, `${name}: "|| true" swallows a failure`);
    assert.doesNotMatch(text, /;\s*exit\s+0/, `${name}: "exit 0" hides a failure`);
  }
});

test('the mandatory gate list is present in the verify workflow', () => {
  assert.ok(ci.length >= 1, 'no verify workflow found');
  // The gates may live in the workflow or in the `ci:verify` script it calls.
  // Either is fine; what must not happen is a gate missing from both.
  const verifyScript = String(rootScripts['ci:verify'] || '');
  const gates = [
    ['check:encoding', 'encoding check'],
    ['prisma:generate', 'prisma client generation'],
    ['prisma:validate', 'schema validation'],
    ['typecheck', 'typecheck of both projects'],
    ['test:audit', 'the audit contract suite'],
    ['test:unit', 'backend and frontend unit tests'],
    ['build:full', 'the full build'],
    ['compose config', 'compose validation'],
  ];
  for (const [needle, label] of gates) {
    const inWorkflow = ci.some((w) => w.text.includes(needle));
    const inScript = verifyScript.includes(needle);
    assert.ok(inWorkflow || inScript,
      `the ${label} gate is missing from both the workflow and ci:verify`);
  }
  // If the gate is centralised, the workflow must actually call it.
  for (const workflow of ci) {
    if (workflow.text.includes('ci:verify')) {
      assert.ok(verifyScript, 'a workflow calls ci:verify but the script is empty');
    }
  }
});

test('the root test script is not a frontend-only green', () => {
  // FC-QA-001's original finding: `npm test` ran the frontend only, so a broken
  // backend could not turn CI red.
  assert.match(String(rootScripts['test:unit'] || ''), /test:backend/,
    'test:unit must include the backend suite');
  assert.ok(rootScripts['test:backend'], 'a test:backend script must exist');
  const backendPkg = JSON.parse(read('backend/package.json'));
  assert.ok(backendPkg.scripts && backendPkg.scripts.test,
    'the backend workspace must define a test script, or test:backend silently does nothing');
});

test('the CI simulation script exists and fails loudly', () => {
  const script = read('scripts/ci-runtime-gate.mjs');
  assert.match(script, /process\.exitCode = 1/,
    'the gate runner must return nonzero when a gate fails');
  assert.match(script, /break;/,
    'the runner must stop at the first failure instead of continuing');
  // It must actually run commands rather than assert that it would.
  assert.match(script, /spawn\(/);
  assert.ok(rootScripts['ci:verify'] || rootScripts['ci:runtime'],
    'package.json must expose the CI gate to workflows and developers alike');
});

test('E2E runs against a real service, not a job that sleeps', () => {
  const runtime = all.filter((w) => /test:e2e/.test(w.text));
  assert.ok(runtime.length >= 1, 'no workflow runs the E2E suite');
  for (const workflow of runtime) {
    assert.match(workflow.text, /until curl|health|wait/,
      `${workflow.name}: the E2E job must wait for a real readiness signal`);
    assert.doesNotMatch(workflow.text, /^\s*run:\s*sleep\s+\d+\s*$/m,
      `${workflow.name}: a bare sleep is not readiness`);
    assert.match(workflow.text, /docker compose (up|down)/,
      `${workflow.name}: the E2E job must manage the compose stack it tests`);
  }
});
