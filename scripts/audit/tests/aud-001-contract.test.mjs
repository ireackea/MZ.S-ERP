// FC-AUD-001 — Durable audit boundary.
// Fails if a privileged mutation can commit without its audit row, if audit
// metadata can carry a credential, or if history can be deleted instead of
// archived.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const backendSrc = join(repoRoot, 'backend/src');
const frontendSrc = join(repoRoot, 'frontend/src');

const read = (path) => readFileSync(path, 'utf8');

const walk = (dir, predicate) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, predicate);
    return predicate(entry) ? [full] : [];
  });

const backendFiles = walk(backendSrc, (n) => n.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(n));
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

test('no privileged mutation uses a fire-and-forget audit write', () => {
  const offenders = [];
  for (const file of backendFiles) {
    const code = stripComments(read(file));
    if (/\bvoid\s+(this\.)?auditService\./.test(code)) {
      offenders.push(relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, [], `Detached audit writes still present: ${offenders.join(', ')}`);
});

test('the idempotency helpers accept a transaction-scoped audit hook', () => {
  const shared = read(join(backendSrc, 'common/idempotency.ts'));
  assert.match(shared, /audit\?: \(tx: Prisma\.TransactionClient, result: T\)/,
    'shared executeIdempotently must accept an audit callback');
  assert.match(shared, /if \(audit\)\s*\{\s*await audit\(tx, result\)/,
    'the audit callback must run inside the transaction');

  const txService = read(join(backendSrc, 'transaction/transaction.service.ts'));
  assert.match(txService, /audit\?: \(tx: Prisma\.TransactionClient, result: T\)/,
    'transaction executeIdempotently must accept an audit callback');
});

test('financial mutations pass the transaction client into the audit write', () => {
  const transaction = read(join(backendSrc, 'transaction/transaction.service.ts'));
  const stocktaking = read(join(backendSrc, 'stocktaking/stocktaking.service.ts'));

  for (const [name, source] of [['transaction', transaction], ['stocktaking', stocktaking]]) {
    const clientWrites = (source.match(/\{ client: tx \}/g) || []).length;
    assert.ok(clientWrites > 0, `${name}.service.ts writes audit without a transaction client`);
  }

  // The specific financial actions must be transaction-scoped.
  for (const action of ['TRANSACTION_CREATE', 'TRANSACTION_UPDATE', 'TRANSACTION_DELETE', 'TRANSACTION_ADJUST', 'TRANSACTION_MIGRATE']) {
    assert.ok(transaction.includes(`'${action}'`), `missing audit action ${action}`);
  }
  for (const action of ['STOCKTAKING_CLOSE', 'STOCKTAKING_REOPEN']) {
    assert.ok(stocktaking.includes(`'${action}'`), `missing audit action ${action}`);
  }
});

test('a role permission change commits its audit row in the same transaction', () => {
  const users = read(join(backendSrc, 'users/users.service.ts'));
  assert.match(users, /this\.prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?tx\.role\.update/,
    'the role update must happen inside a transaction');
  assert.match(users, /ROLE_PERMISSIONS_UPDATE/);
  // The before/after pair is what makes an escalation reconstructable.
  assert.match(users, /before:\s*\{\s*permissions/);
  assert.match(users, /after:\s*\{\s*permissions/);
});

test('audit metadata is redacted centrally', () => {
  const redaction = read(join(backendSrc, 'audit/audit-redaction.ts'));
  assert.match(redaction, /export const redactMetadata/);
  assert.match(redaction, /export const isSensitiveKey/);
  // The unit suite proves the actual key coverage; here we only assert the
  // wiring, so a rename cannot silently drop redaction from the write path.
  assert.match(redaction, /SENSITIVE_KEY_PATTERN/);
  assert.match(redaction, /looksLikeJwt|looksLikeBearer/,
    'credential-shaped values must be masked even under an innocent key');

  const service = read(join(backendSrc, 'audit/audit.service.ts'));
  assert.match(service, /redactMetadata/, 'audit writes must pass through redaction');
  assert.match(service, /options\?\.client \|\| this\.getPrisma\(\)/,
    'logItemAction must honour a supplied transaction client');
  assert.match(service, /from '\.\/audit-redaction'/);
});

test('the service exposes search, export and archive-based retention', () => {
  const service = read(join(backendSrc, 'audit/audit.service.ts'));
  assert.match(service, /async queryLogs\(/, 'missing paginated search');
  assert.match(service, /async exportLogs\(/, 'missing export contract');
  assert.match(service, /async archiveExpired\(/, 'missing retention job');
  assert.match(service, /async listArchived\(/, 'archived history must stay retrievable');

  // Retention archives; it must never delete audit rows.
  const archive = service.slice(service.indexOf('async archiveExpired'), service.indexOf('async listArchived'));
  assert.ok(!/auditLog\.delete/.test(archive), 'retention must not delete audit rows');
  assert.match(archive, /status:\s*'ARCHIVED'/);

  const controller = read(join(backendSrc, 'audit/audit.controller.ts'));
  assert.match(controller, /@Get\('logs\/export'\)/);
  assert.match(controller, /@Get\('archived'\)/);
  assert.match(controller, /Content-Disposition/);
  assert.match(service, /text\/csv/, 'the export must declare a CSV content type');
});

test('archived rows are hidden from the default window but not dropped', () => {
  const service = read(join(backendSrc, 'audit/audit.service.ts'));
  assert.match(service, /not: 'ARCHIVED'/, 'default search must exclude archived rows');
  const where = service.slice(service.indexOf('const where: Prisma.AuditLogWhereInput'));
  assert.ok(!/auditLog\.deleteMany|auditLog\.delete\(/.test(where), 'search path must not delete');
});

test('the client no longer keeps an audit trail in browser storage', () => {
  const offenders = [];
  for (const file of walk(frontendSrc, (n) => /\.(ts|tsx)$/.test(n) && !/\.(test|spec)\./.test(n))) {
    // storageOwnership.ts is the registry that *declares* these keys forbidden.
    if (file.endsWith('storageOwnership.ts')) continue;
    const code = stripComments(read(file));
    if (code.includes('feed_factory_user_activity_logs') || code.includes('feed_factory_audit_logs')) {
      offenders.push(relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, [], `Audit evidence still written to the browser: ${offenders.join(', ')}`);

  // The registry must still list them as forbidden, so a regression is caught.
  const registry = read(join(frontendSrc, 'services/storageOwnership.ts'));
  assert.match(registry, /feed_factory_audit_logs.*SECRET_FORBIDDEN/);
  assert.match(registry, /feed_factory_user_activity_logs.*SECRET_FORBIDDEN/);
  assert.ok(
    !/getAuditLogs|addAuditLog/.test(read(join(frontendSrc, 'services/storage.ts'))),
    'storage.ts must no longer expose localStorage audit accessors',
  );

  const iam = read(join(frontendSrc, 'services/iamService.ts'));
  assert.match(iam, /apiClient\s*\.\s*post\('\/audit\/client-activity'/, 'client activity must be posted to the backend');
});

test('the backend accepts client activity and stamps the actor from the session', () => {
  const controller = read(join(backendSrc, 'audit/audit.controller.ts'));
  assert.match(controller, /@Post\('client-activity'\)/);
  assert.match(controller, /@AllowAuthenticated\(\)/);
  // The actor must come from the request principal, never from the payload.
  const block = controller.slice(controller.indexOf('recordClientActivity'));
  assert.ok(!/body\?\.(userId|actorId|userName)/.test(block), 'client must not be able to choose its own actor');
});
