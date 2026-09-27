// Gate 1.1 — the backup surface was open to any signed-in user.
//
// `BackupGuard` set `request.backupActor` and threw away the permissions
// `verifyToken` had just read from the database. `RbacGuard` then granted a
// hardcoded `['backup.*']` for anything carrying that actor, so holding a
// session cookie was enough to create full database dumps and delete archives —
// and a dump contains every `users.passwordHash`.
//
// The discriminator that was missing is `type`: the shared-secret service token
// and an ordinary session cookie both land in the same branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const guard = readFileSync(join(repoRoot, 'backend/src/auth/rbac.guard.ts'), 'utf8');
const backupGuard = readFileSync(join(repoRoot, 'backend/src/backup/backup.guard.ts'), 'utf8');
const controller = readFileSync(join(repoRoot, 'backend/src/backup/backup.controller.ts'), 'utf8');

test('gate 1.1 no principal is granted backup.* without holding it', () => {
  assert.doesNotMatch(
    guard,
    /const permissions = \['backup\.\*'\]/,
    'a hardcoded backup.* grant is an authorisation bypass, not a convenience',
  );

  // The widening is only legitimate for a shared-secret service token, and it has
  // to sit behind that test. Compared by position rather than by pattern: the
  // condition contains nested parentheses, so a regex over it is either too
  // permissive to be a guard or too strict to survive a reformat.
  const branch = guard.slice(guard.indexOf('const backupActor = request?.backupActor;'));
  const systemCheck = branch.indexOf("=== 'system'");
  const widening = branch.indexOf("['backup.*']");

  assert.ok(systemCheck >= 0, 'the widening must be gated on the actor being a service token');
  assert.ok(widening > systemCheck, 'the backup.* grant must come after the type check, not before it');

  const between = branch.slice(systemCheck, widening);
  assert.match(
    between,
    /=== 'system'\)\s*\{\s*return\s*\{\s*role,\s*permissions:/,
    'the type check must immediately guard the widened return, with nothing in between',
  );
});

test('gate 1.1 a cookie session is authorized by its role, not by being a session', () => {
  // BackupGuard has to hand the principal over, or RbacGuard is guessing.
  assert.match(
    backupGuard,
    /request\.user = user/,
    'a verified cookie must populate request.user so every guard sees the same principal',
  );
  assert.match(
    backupGuard,
    /permissions:\s*Array\.isArray\(user\.permissions\)/,
    'the permissions verifyToken read from the database must travel with the request',
  );

  // And a cookie that fails verification must not quietly become a service token.
  const cookieBlock = backupGuard.slice(backupGuard.indexOf('if (cookieToken)'));
  assert.doesNotMatch(
    cookieBlock.slice(0, cookieBlock.indexOf('const token =')),
    /catch \{[^}]*request\.backupActor\s*=/,
    'a rejected cookie must fall through to the token path, not authenticate as one',
  );
});

test('gate 1.1 an unknown actor is denied rather than widened', () => {
  // No permissions established means no permissions. The previous code treated a
  // missing list as a reason to grant everything.
  const branch = guard.slice(guard.indexOf('const backupActor = request?.backupActor;'));
  assert.match(
    branch,
    /Array\.isArray\(backupActor\.permissions\)\s*\?[\s\S]{0,240}?:\s*\[\]/,
    'a backup actor with no readable permissions must resolve to an empty grant, not a wide one',
  );
  assert.doesNotMatch(branch, /permissions = \['backup\.\*'\]/);
});

test('gate 1.1 every backup route still carries a permission requirement', () => {
  // The decorators were always there and always unread. Asserting their presence
  // alone is what let the bypass look defended, so the point of this test is the
  // E2E one in tests/e2e/backup-rbac.spec.ts, which drives a real session.
  const routes = controller.match(/@(Get|Post|Put|Patch|Delete)\([^)]*backup[^)]*\)/g) || [];
  assert.ok(routes.length >= 10, `expected the backup surface to be declared, found ${routes.length}`);

  const permissions = controller.match(/@Permissions\('backup\.[a-z]+'\)/g) || [];
  assert.ok(
    permissions.length >= routes.length,
    `every backup route needs a @Permissions decorator: ${routes.length} routes, ${permissions.length} decorators`,
  );
});
