import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const productionCompose = readFileSync(resolve(root, 'docker-compose.prod.yml'), 'utf8');
const productionDockerfile = readFileSync(resolve(root, 'backend/Dockerfile.prod'), 'utf8');
const canonicalDockerfile = readFileSync(resolve(root, 'backend/Dockerfile'), 'utf8');

test('production compose uses the maintained backend image definition', () => {
  assert.match(productionCompose, /context:\s*\.\/backend\s*[\r\n]+\s*dockerfile:\s*Dockerfile\s*$/m);
  assert.doesNotMatch(productionCompose, /backend\/Dockerfile\.prod/);
  assert.doesNotMatch(productionCompose, /pm2-runtime/i);
});

test('production runtime mounts do not shadow Prisma or point uploads at the wrong root', () => {
  assert.doesNotMatch(productionCompose, /prisma-data:\/app\/prisma/);
  assert.match(productionCompose, /\.\/backend\/uploads:\/app\/uploads$/m);
  assert.doesNotMatch(productionCompose, /\/app\/backend\/uploads/);
});

test('production compose has no SQLite or legacy deployment markers', () => {
  assert.doesNotMatch(productionCompose, /file:\.\/|sqlite/i);
  assert.doesNotMatch(productionCompose, /dockerfile:\s*backend\/Dockerfile\.prod/);
});

test('the maintained image uses PostgreSQL-compatible Node runtime and migrations', () => {
  assert.match(canonicalDockerfile, /FROM node:20-bookworm-slim/);
  assert.match(canonicalDockerfile, /prisma migrate deploy|prisma:migrate:prod/);
  assert.match(canonicalDockerfile, /node dist\/main\.js/);
});

test('legacy image remains explicitly unsupported until it is removed', () => {
  assert.match(productionDockerfile, /Legacy|old|قديم|DANGER/i);
  assert.doesNotMatch(canonicalDockerfile, /DATABASE_URL=file:|pm2-runtime/i);
});
