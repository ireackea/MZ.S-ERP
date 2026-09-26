import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const backendPackage = JSON.parse(read('backend/package.json'));
const rootScripts = JSON.parse(read('package.json')).scripts;
const postinstall = read('scripts/postinstall.mjs');
const activeConfig = read('backend/prisma.config.ts');

test('backend Prisma scripts use the maintained backend config', () => {
  assert.equal(backendPackage.scripts['prisma:generate'], 'prisma generate --config prisma.config.ts');
  assert.equal(backendPackage.scripts['prisma:migrate:dev'], 'prisma migrate dev --config prisma.config.ts');
  assert.equal(backendPackage.scripts['prisma:migrate:prod'], 'prisma migrate deploy --config prisma.config.ts');
  assert.match(postinstall, /'generate',\s*'--config',\s*'prisma\.config\.ts'/);
  assert.doesNotMatch(rootScripts['prisma:generate'], /backend\/prisma\.config/);
});

test('the maintained backend Prisma config is non-empty and schema-relative', () => {
  assert.ok(activeConfig.length > 100);
  assert.match(activeConfig, /schema:\s*'prisma\/schema\.prisma'/);
  assert.match(activeConfig, /path:\s*'prisma\/migrations'/);
  assert.match(activeConfig, /url:\s*process\.env\.DATABASE_URL/);
});

test('nested empty Prisma config cannot be selected as an active config', () => {
  const nested = resolve(root, 'backend/prisma/prisma.config.ts');
  assert.equal(statSync(nested).size, 0);
  assert.doesNotMatch(activeConfig, /prisma\/prisma\.config/);
  assert.doesNotMatch(postinstall, /backend\/prisma\/prisma\.config/);
});

test('root Prisma config is a compatibility shim, not a second source of truth', () => {
  const rootConfig = read('prisma.config.ts');
  assert.match(rootConfig, /schema:\s*'backend\/prisma\/schema\.prisma'/);
  assert.match(rootConfig, /migrations:\s*\{/);
  assert.doesNotMatch(rootConfig, /file:\.\/prisma\/dev\.db/);
});

test('the maintained Prisma client can be generated through the declared command', () => {
  const output = execFileSync(process.execPath, [
    resolve(root, 'node_modules/prisma/build/index.js'),
    'generate',
    '--config',
    'prisma.config.ts',
  ], {
    cwd: resolve(root, 'backend'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /Generated Prisma Client|Generated Prisma/i);
});
