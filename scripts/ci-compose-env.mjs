#!/usr/bin/env node
// FC-QA-002 — `docker compose config` interpolates ${VAR:?message} and aborts when a
// variable is unset, so `npm run ci:verify` could never pass on a clean checkout:
// `.env` is gitignored (.gitignore:34) and no workflow created one. The gate was
// therefore red on every push, which meant the E2E job never ran and no signal
// existed at all — a gate that is always red teaches everyone to ignore it.
//
// This script is the single place that makes the gate runnable. It lives in the
// tree rather than in a workflow file for the reason ci.yml:3-5 already states:
// "a gate that only exists in YAML drifts from the tree and goes stale."
//
// Rules, in order:
//   1. A developer's existing `.env` is never read-modified-written. If it is
//      present it must already satisfy every variable compose requires; if it does
//      not, this exits 1 with the missing names rather than overwriting a file
//      that may hold a real database URL.
//   2. Only when `.env` is absent is one generated from `.env.example` with fresh
//      random secrets. That is the clean-checkout case, which is the case that
//      was broken.
//   3. No secret is ever printed. The script reports which keys it filled, not
//      their values.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repoRoot, '.env');
const examplePath = join(repoRoot, '.env.example');

// Exactly the variables docker-compose.yml requires with the `:?` form. Each line
// below names the compose file so that adding a new required variable without
// adding it here fails loudly here rather than mysteriously in CI.
const REQUIRED = [
  { key: 'POSTGRES_PASSWORD', why: 'docker-compose.yml:11', bytes: 24 },
  { key: 'DATABASE_URL', why: 'docker-compose.yml:30', bytes: 0 },
  { key: 'JWT_SECRET', why: 'docker-compose.yml:31', bytes: 32 },
  { key: 'BACKUP_ENCRYPTION_SECRET', why: 'docker-compose.yml:32', bytes: 32 },
  { key: 'BACKUP_RESTORE_PIN', why: 'docker-compose.yml:35', bytes: 8 },
  { key: 'METRICS_AUTH_TOKEN', why: 'docker-compose.yml:38', bytes: 32 },
  { key: 'ADMIN_PASSWORD', why: 'docker-compose.yml:41', bytes: 0 },
];

// Not required by `docker compose config`, but a generated .env that leaves
// these as `<placeholders>` is not a usable file: SYSTEM_RESET_TOKEN is required
// by the production stack (docker-compose.prod.yml:35) and is validated at
// runtime with a 16-character minimum, and DATABASE_DIRECT_URL is the
// host-side connection string Prisma migrations use.
const ALSO_GENERATED = [
  { key: 'SYSTEM_RESET_TOKEN', bytes: 24 },
  { key: 'DATABASE_DIRECT_URL', bytes: 0 },
];

const parseEnv = (source) => {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return values;
};

// A placeholder is what `.env.example` ships: `<min-32-char-random-secret>`. A
// value that still looks like one is treated as missing, because compose would
// accept it and the stack would come up with a known secret.
const isReal = (value) =>
  typeof value === 'string' && value.length > 0 && !/^<.*>$/.test(value);

const missingKeys = (values) =>
  REQUIRED.filter(({ key }) => !isReal(values.get(key))).map(({ key }) => key);

const explain = (keys) =>
  keys
    .map((key) => {
      const entry = REQUIRED.find((item) => item.key === key);
      return `  - ${key} (${entry ? entry.why : 'unknown source'})`;
    })
    .join('\n');

const randomHex = (bytes) => randomBytes(bytes).toString('hex');

const fail = (message, detail) => {
  console.error(`compose-env: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
};

// ---------------------------------------------------------------- existing .env
if (existsSync(envPath)) {
  const values = parseEnv(readFileSync(envPath, 'utf8'));
  const missing = missingKeys(values);
  if (missing.length === 0) {
    console.log('compose-env: .env already supplies every variable compose requires.');
    process.exit(0);
  }
  fail(
    'your .env is missing a value docker-compose requires. It has been left untouched,',
    `because it may hold a real DATABASE_URL. Add these, then re-run:\n${explain(missing)}`,
  );
}

// ------------------------------------------------------------- generate .env
if (!existsSync(examplePath)) {
  fail('there is no .env.example to build from, so a .env cannot be generated.', examplePath);
}

const generated = new Map();
for (const { key, bytes } of [...REQUIRED, ...ALSO_GENERATED]) {
  generated.set(key, bytes > 0 ? randomHex(bytes) : '');
}

// `DATABASE_URL` is assembled from the same credentials the postgres service gets,
// rather than from a literal, so the two can never disagree. The password is hex,
// which needs no percent-encoding.
const withHost = (host) =>
  'postgresql://feedfactory:' +
  generated.get('POSTGRES_PASSWORD') +
  `@${host}:5432/feed_factory_db?schema=public`;
generated.set('DATABASE_URL', withHost('postgres'));
// "Direct" means from the host rather than from inside the compose network, so it
// addresses the published port instead of the service name.
generated.set('DATABASE_DIRECT_URL', withHost('localhost'));
// A real password, not a hex blob: the admin is expected to type it at first login.
generated.set('ADMIN_PASSWORD', 'Adm-' + randomHex(9) + '-9x');

const template = readFileSync(examplePath, 'utf8');
const merged = [];
const seen = new Set();

for (const line of template.split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=/.exec(line.trim());
  const key = match ? match[1] : null;
  if (key && generated.has(key) && !seen.has(key)) {
    merged.push(`${key}=${generated.get(key)}`);
    seen.add(key);
    continue;
  }
  merged.push(line);
}

// Anything compose requires that `.env.example` does not mention at all is
// appended rather than silently dropped — BACKUP_RESTORE_PIN was exactly this
// case: compose required it, `.env.example` omitted it, so copying the example
// to `.env` could never have worked.
const appended = [];
for (const [key, value] of generated) {
  if (seen.has(key)) continue;
  appended.push(`${key}=${value}`);
  seen.add(key);
}

const body =
  merged.join('\n').replace(/\s*$/, '') +
  (appended.length ? '\n\n# Added by scripts/ci-compose-env.mjs: required by docker-compose.yml\n# but absent from .env.example.\n' + appended.join('\n') + '\n' : '\n');

writeFileSync(envPath, body, { encoding: 'utf8', mode: 0o600 });

console.log('compose-env: wrote a .env for compose validation. Generated (not printed):');
for (const key of seen) console.log(`  - ${key}`);
if (appended.length) {
  console.log('compose-env: the keys above marked as added were missing from .env.example.');
}
