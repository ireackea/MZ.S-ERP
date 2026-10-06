import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const exists = (path) => existsSync(join(repoRoot, path));

/**
 * The gate has to be runnable, and a bulk import has to fit through the proxy.
 *
 * Both of these were broken in a way that made everything else unverifiable.
 *
 * `npm run ci:verify` ends with `docker compose config --quiet`, and
 * docker-compose.yml requires seven variables with the `:?` form, which aborts
 * interpolation when one is unset. `.env` is gitignored and no workflow created
 * one, so the gate was red on every push and every pull request. A gate that is
 * always red is not a gate: the E2E job sat behind it, so no end-to-end test ran
 * in CI at all, and `tests/e2e/items-order-import.spec.ts` — the only spec that
 * exercises the item import — was wired to no script in any workflow.
 *
 * Separately, neither nginx config declared `client_max_body_size` in the default
 * stack, so nginx applied its own 1 MiB. A 15,000-row import measures about 4 MB,
 * which means the one-command production path could not perform one: it answered
 * 413 with an HTML page, and the SPA has no 413 branch to turn that into a
 * message an operator can act on.
 */
test('the compose environment is provisioned from the tree, not from workflow YAML', () => {
  const scripts = JSON.parse(read('package.json')).scripts || {};

  assert.ok(
    exists('scripts/ci-compose-env.mjs'),
    'scripts/ci-compose-env.mjs must exist. It is the single place that makes `docker compose config` runnable, and it lives in the tree because ci.yml already states the rule: a gate that only exists in YAML drifts from the tree and goes stale.',
  );
  assert.match(
    scripts['ci:verify'] || '',
    /ci:compose-env/,
    'ci:verify must provision the environment before `docker compose config --quiet`, or the gate aborts on interpolation before it validates anything.',
  );
  assert.match(
    scripts['ci:compose-env'] || '',
    /ci-compose-env\.mjs/,
    'the ci:compose-env script must invoke the provisioning script.',
  );

  // Ordering matters: the check has to come after the tests, or a broken
  // environment fails the job for the wrong reason and hides the real signal.
  const verify = scripts['ci:verify'] || '';
  assert.ok(
    verify.indexOf('ci:compose-env') > verify.indexOf('test:unit'),
    'ci:compose-env must run after the unit tests. A missing .env should not be the first thing a developer is told about.',
  );
});

test('the provisioning script refuses to overwrite a developer .env', () => {
  const source = read('scripts/ci-compose-env.mjs');
  assert.doesNotMatch(
    source,
    /writeFileSync\(\s*envPath[\s\S]{0,400}?existsSync\(\s*envPath\s*\)[\s\S]{0,200}?writeFileSync/,
    'The script must not write .env after checking that it exists. It may hold a real DATABASE_URL.',
  );
  assert.match(
    source,
    /process\.exit\(1\)/,
    'An existing but incomplete .env must fail loudly with the missing names, not be silently replaced.',
  );
  assert.doesNotMatch(
    source,
    /console\.(log|info)\([^)]*\b(get|generated\.get)\(['"]?[A-Z_]+['"]?\b/,
    'The script must never print a generated secret value. It reports which keys it filled, not their contents.',
  );
});

test('every variable docker-compose requires can be produced without hand-editing', () => {
  const compose = read('docker-compose.yml');
  const example = read('.env.example');
  const script = read('scripts/ci-compose-env.mjs');

  // The `:?` form is Compose's hard-error form, so each of these aborts
  // `docker compose config` when absent. This is the list that was missing.
  const required = [...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((match) => match[1]);
  assert.ok(required.length > 0, 'no `:?` variables found in docker-compose.yml — if the syntax changed, point this guard at the new form.');

  for (const key of required) {
    assert.match(
      script,
      new RegExp(`key:\\s*'${key}'`),
      `docker-compose.yml requires ${key} with the \`:?\` form, so \`docker compose config\` aborts without it. The provisioning script must be able to produce it.`,
    );
  }

  // Anything compose requires that .env.example never mentions is a trap: copying
  // the example to .env is the obvious first step and it cannot work.
  const exampleKeys = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]));
  const missingFromExample = required.filter((key) => !exampleKeys.has(key));
  assert.deepEqual(
    missingFromExample,
    [],
    `docker-compose.yml requires ${missingFromExample.join(', ')} but .env.example does not list ${missingFromExample.length === 1 ? 'it' : 'them'}. Copying the example to .env would then fail, which is how this stayed broken: BACKUP_RESTORE_PIN was exactly this case.`,
  );
});

test('both nginx configs accept a body the importer can produce', () => {
  const configs = ['frontend/nginx.frontend.conf', 'nginx.prod.conf'].filter(exists);
  assert.ok(configs.length > 0, 'no nginx config found — if it was renamed, point this guard at the new name.');

  for (const path of configs) {
    const source = read(path);
    const limit = /client_max_body_size\s+(\d+)([km])/i.exec(source);
    assert.ok(
      limit,
      `${path} declares no client_max_body_size, so nginx applies its own 1 MiB. A 15,000-row Arabic import measures about 4 MB, so the documented deploy path answers 413 and the operator sees an HTML page rendered into a toast.`,
    );
    const megabytes = Number(limit[1]) * (limit[2].toLowerCase() === 'm' ? 1 : 1 / 1024);
    assert.ok(
      megabytes >= 5,
      `${path} allows ${limit[0]}, which is below the ~4 MB a full 15,000-row import produces plus headroom. Keep it in step with JSON_BODY_LIMIT in .env.example and MAX_BULK_IMPORT_ROWS.`,
    );
  }
});

test('the API proxy can wait as long as a bulk import legitimately takes', () => {
  for (const path of ['frontend/nginx.frontend.conf', 'nginx.prod.conf'].filter(exists)) {
    const source = read(path);
    const apiBlock = /location \/api\/ \{([\s\S]*?)\n  \}/.exec(source);
    assert.ok(apiBlock, `${path} has no /api/ location block to check.`);
    const readTimeout = /proxy_read_timeout\s+(\d+)s/.exec(apiBlock[1]);
    assert.ok(readTimeout, `${path} declares no proxy_read_timeout for /api/, so nginx applies its own 60s.`);
    assert.ok(
      Number(readTimeout[1]) >= 180,
      `${path} allows ${readTimeout[0]} for /api/. A bulk import is one long request; at 60s nginx closes the socket while the backend keeps inserting, so the operator is told the import failed and the catalogue grew anyway.`,
    );
  }
});
