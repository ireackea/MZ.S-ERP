/**
 * FC-QA-001 — the CI runtime gate.
 *
 * FC-QA-001's finding was a green CI that was not testing anything: a job that
 * started containers and slept, `continue-on-error` on tests, and a test script
 * that only covered the frontend. This script runs the same gates a developer
 * and CI share, and returns a nonzero exit code if any of them fails, so a
 * broken tree cannot be reported as green.
 *
 * Usage:
 *   node scripts/ci-runtime-gate.mjs            # run every gate
 *   node scripts/ci-runtime-gate.mjs --list     # print gates, run nothing
 *   node scripts/ci-runtime-gate.mjs --only=e2e # run a subset by name
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

/**
 * Each gate is a real command with a reason. The order matters: the cheap static
 * checks fail fast before the expensive build and the browser E2E.
 */
const gates = [
  { name: 'encoding', command: [npm, 'run', 'check:encoding'], why: 'source files must be valid UTF-8' },
  { name: 'prisma-generate', command: [npm, 'run', 'prisma:generate'], why: 'the client must match the schema' },
  { name: 'prisma-validate', command: [npm, 'run', 'prisma:validate'], why: 'the schema must be loadable' },
  { name: 'typecheck-backend', command: ['npm', 'exec', 'tsc', '--', '--noEmit', '-p', 'backend/tsconfig.json'], why: 'backend types must compile' },
  { name: 'typecheck-frontend', command: ['npm', 'exec', 'tsc', '--', '--noEmit', '-p', 'frontend/tsconfig.json'], why: 'frontend types must compile' },
  { name: 'audit-contracts', command: [npm, 'run', 'test:audit'], why: 'the audit suite guards every accepted card' },
  { name: 'unit-backend', command: [npm, 'run', 'test:backend'], why: 'backend unit tests are mandatory, not optional' },
  { name: 'unit-frontend', command: [npm, 'run', 'test', '--workspace=frontend', '--', '--run'], why: 'frontend unit tests are mandatory' },
  { name: 'build-full', command: [npm, 'run', 'build:full'], why: 'both workspaces must build' },
  { name: 'compose-config', command: ['docker', 'compose', 'config', '--quiet'], why: 'the deployment path must be valid' },
];

const run = (command) => new Promise((resolve) => {
  const child = spawn(command[0], command.slice(1), { cwd: repoRoot, shell: process.platform === 'win32' });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => resolve({ code: code ?? 1, output }));
  child.on('error', (error) => resolve({ code: 1, output: `${output}\n${error.message}` }));
});

const main = async () => {
  if (listOnly) {
    for (const gate of gates) console.log(`${gate.name.padEnd(20)} ${gate.command.join(' ')}`);
    return;
  }

  const selected = only ? gates.filter((g) => g.name === only) : gates;
  if (only && selected.length === 0) {
    console.error(`No gate named "${only}". Known gates: ${gates.map((g) => g.name).join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const gate of selected) {
    const started = Date.now();
    process.stdout.write(`[gate] ${gate.name} — ${gate.why}\n`);
    const { code, output } = await run(gate.command);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const passed = code === 0;
    results.push({ name: gate.name, passed, exitCode: code, seconds, why: gate.why, tail: output.slice(-1200) });
    console.log(`[gate] ${gate.name} ${passed ? 'PASS' : `FAIL (exit ${code})`} in ${seconds}s`);

    // A failing gate must stop the run: continuing would let a later green step
    // hide the failure, which is exactly how the old CI produced a false green.
    if (!passed) {
      console.error(`\n--- ${gate.name} output (tail) ---\n${output.slice(-1200)}\n`);
      break;
    }
  }

  const outDir = join(repoRoot, '.hermes', 'proof', 'QA-001');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'ci-gates.json'),
    JSON.stringify({ card: 'FC-QA-001', generatedAt: new Date().toISOString(), results }, null, 2).replace(/\u2026/g, '...'),
    'utf8',
  );

  const failed = results.filter((r) => !r.passed);
  const notRun = selected.length - results.length;
  console.log(`\n${results.length - failed.length}/${selected.length} gate(s) passed${notRun > 0 ? `, ${notRun} not reached` : ''}`);
  if (failed.length) {
    console.error(`FAILED: ${failed.map((f) => `${f.name} (exit ${f.exitCode})`).join(', ')}`);
    process.exitCode = 1;
  }
};

await main();
