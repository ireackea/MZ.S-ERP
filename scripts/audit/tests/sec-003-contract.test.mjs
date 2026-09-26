// FC-SEC-003 — Legacy authentication surface and secret removal.
// Fails if a secret, a client-side credential store, an auth bypass, or a
// client-side impersonation primitive reappears in the frontend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const frontendSrc = join(repoRoot, 'frontend/src');
const backendSrc = join(repoRoot, 'backend/src');

const read = (path) => readFileSync(path, 'utf8');

/** All frontend source files, excluding tests and vendored archives. */
const frontendFiles = (dir = frontendSrc) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return frontendFiles(full);
    if (!/\.(ts|tsx|js|jsx)$/.test(entry)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) return [];
    return [full];
  });

const sources = frontendFiles().map((path) => ({ path, rel: relative(repoRoot, path), text: read(path) }));
const byName = (name) => sources.filter((entry) => entry.rel.replace(/\\/g, '/').endsWith(name));

/** Strips comments so a guard can match real code, not the note that removed it. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const codeOf = (entry) => stripComments(entry.text);

test('no hardcoded credential or secret literal in frontend source', () => {
  const patterns = [
    [/hashString\(\s*['"`][^'"`]+['"`]/, 'hardcoded password passed to a hash function'],
    [/['"`]Admin@?\d*!['"`]/, 'hardcoded admin password literal'],
    [/['"`]445566['"`]/, 'hardcoded default PIN literal'],
    [/['"`]password123['"`]/, 'hardcoded demo password'],
    [/VITE_[A-Z_]*(TOKEN|SECRET|KEY|PASSWORD)/, 'VITE_ variable that would inline a secret into the bundle'],
    [/x-backup-token/, 'shared backup token header'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'embedded private key'],
    [/\beyJ[A-Za-z0-9_-]{10,}\./, 'literal JWT'],
  ];

  const offenders = [];
  for (const { rel, text } of sources) {
    for (const [pattern, why] of patterns) {
      const match = text.match(pattern);
      if (match) offenders.push(`${rel}: ${why} -> ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `Secrets found in the frontend:\n${offenders.join('\n')}`);
});

test('the client-side authentication controller is gone', () => {
  assert.equal(byName('services/authController.ts').length, 0, 'authController.ts still exists in frontend/src');
  assert.equal(byName('components/AuthenticationPortal.tsx').length, 0, 'AuthenticationPortal.tsx still exists in frontend/src');
});

test('no client-side credential, OTP, or lockout store', () => {
  const forbiddenKeys = [
    'feed_factory_auth_credentials',
    'feed_factory_auth_2fa_challenges',
    'feed_factory_auth_attempts',
    'feed_factory_auth_lockouts',
  ];
  const offenders = [];
  for (const { rel, text } of sources) {
    for (const key of forbiddenKeys) {
      // storageOwnership.ts may *declare* a key forbidden; it may not use one.
      if (rel.replace(/\\/g, '/').endsWith('services/storageOwnership.ts')) continue;
      if (text.includes(key)) offenders.push(`${rel}: references ${key}`);
    }
  }
  assert.deepEqual(offenders, [], `Client-side auth state still present:\n${offenders.join('\n')}`);
});

test('no auth bypass flag or impersonation helper remains', () => {
  const banned = [
    'loginAsUser',
    'handleSwitchCurrentUser',
    'requireAuth',
    'forceAccess',
    'skipAuth',
    'disableAuth',
    'mockAuth',
    'devBypass',
    'forceAdmin',
  ];
  const offenders = [];
  for (const { rel, text } of sources) {
    for (const name of banned) {
      if (codeOf({ text }).includes(name)) offenders.push(`${rel}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], `Bypass primitive still reachable:\n${offenders.join('\n')}`);
});

test('no role name is treated as a grant of every permission', () => {
  const offenders = [];
  const roleShortcut = /role\s*\)?\s*\??\.\s*toLowerCase\(\)\s*===?\s*['"`](super)?admin['"`]/;
  for (const { rel, text } of sources) {
    if (roleShortcut.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `Role name still short-circuits authorization in: ${offenders.join(', ')}`);
});

test('no client-side SQL fragment is built from a user-held scope', () => {
  const offenders = sources
    .filter((entry) => codeOf(entry).includes('getScopeWhereClause'))
    .map((entry) => entry.rel);
  assert.deepEqual(offenders, [], `getScopeWhereClause still defined/used: ${offenders.join(', ')}`);
});

test('the system reset shared secret is gone from both tiers', () => {
  const offenders = [];
  for (const { rel, text } of sources) {
    if (/SYSTEM_RESET_TOKEN/.test(text)) offenders.push(`frontend ${rel}`);
  }
  const backend = readdirSync(backendSrc).flatMap((entry) => {
    const full = join(backendSrc, entry);
    return statSync(full).isDirectory() ? [] : [full];
  });
  for (const full of backend) {
    if (!full.endsWith('.ts')) continue;
    if (/getSystemResetToken|SYSTEM_RESET_TOKEN/.test(read(full))) {
      offenders.push(`backend ${relative(repoRoot, full)}`);
    }
  }
  assert.deepEqual(offenders, [], `Reset shared secret still referenced: ${offenders.join(', ')}`);
});

test('admin provisioning happens on the backend, not in the browser', () => {
  const controller = read(join(backendSrc, 'auth/auth.controller.ts'));
  assert.match(controller, /@Post\('setup'\)/, 'backend is missing the one-time setup route');
  const service = read(join(backendSrc, 'auth/auth.service.ts'));
  assert.match(service, /createInitialAdmin/);
  assert.match(service, /ConflictException/, 'setup must refuse once an admin exists');
  assert.match(service, /bcrypt\.hash/, 'setup must hash the password server-side');

  const app = read(join(frontendSrc, 'App.tsx'));
  assert.ok(!/provisionInitialAdmin/.test(app), 'App.tsx still calls the client-side provisioner');
  assert.match(app, /\/auth\/setup/, 'App.tsx should provision through the API');
});

test('no authorization payload is logged in production paths', () => {
  const offenders = [];
  const logPattern = /console\.(log|info|debug)\([^)]*(permissions|LOGIN SUCCESS|currentUser\.SET)/i;
  for (const { rel, text } of sources) {
    if (logPattern.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `Auth/permission data still logged: ${offenders.join(', ')}`);
});

test('the role permission display fallback has a single definition', () => {
  const declarations = sources.filter(
    (entry) => /ROLE_BASED_FALLBACK_PERMISSIONS\s*:\s*Record/.test(entry.text),
  );
  assert.deepEqual(
    declarations.map((entry) => entry.rel),
    [],
    'A component redefined the role→permission fallback table instead of importing the shared one',
  );
  const shared = read(join(frontendSrc, 'services/rolePermissionFallbacks.ts'));
  assert.match(shared, /ROLE_PERMISSION_FALLBACKS/);
});

test('frontend transport still relies on the HttpOnly cookie', () => {
  const client = read(join(frontendSrc, 'api/client.ts'));
  assert.match(client, /withCredentials:\s*true/, 'api client must send the session cookie');
  const authz = sources.filter((entry) => /Authorization\s*:\s*['"`]Bearer\s+\$?\{/.test(entry.text));
  assert.deepEqual(authz.map((entry) => entry.rel), [], 'No component may attach a bearer token manually');
  const cookieReads = sources.filter((entry) => /document\.cookie/.test(entry.text));
  assert.deepEqual(cookieReads.map((entry) => entry.rel), [], 'Frontend must not read document.cookie');
});
