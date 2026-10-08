import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

test('RBAC denies protected routes without authorization metadata', () => {
  const guard = read('backend/src/auth/rbac.guard.ts');
  assert.match(guard, /ALLOW_AUTHENTICATED_METADATA_KEY/);
  assert.match(guard, /Route authorization metadata is required/);
  assert.doesNotMatch(guard, /if \(!requiredPermissions\.length && !requiredRoles\.length\) return true/);
});

test('every route in a guarded controller carries a gate', () => {
  // The guard above is fail-closed, which is why `GET /audit/logs/export` was
  // unreachable rather than open: it was the one route in that controller with no
  // `@Permissions`, and the failure surfaced as a 403 in an e2e test long after the
  // controller was written. Fail-closed is the correct default; it is not a
  // substitute for every route naming what it requires, because the symptom is a
  // dead endpoint rather than an obvious hole.
  //
  // Parsed rather than grepped. A count comparison — "the file mentions
  // @Permissions more often than @Get" — passes as soon as one route is gated and
  // cannot tell which one is not, and the controller in question had five gated
  // routes and one ungated.
  const isDecorator = (line) => /^\s*@/.test(line);
  const isFiller = (line) => /^\s*$/.test(line) || /^\s*(\/\/|\/\*|\*)/.test(line);

  /** Every decorator attached to the member declared at `index`. */
  const decoratorsAround = (lines, index) => {
    const block = [];
    // Downwards: `@Get()` is frequently followed by `@Permissions(...)`, so the gate
    // is not always above the route. Only the first non-decorator, non-comment line
    // ends the block, which is the method signature.
    for (let i = index + 1; i < lines.length; i += 1) {
      if (isDecorator(lines[i])) block.push(lines[i]);
      else if (!isFiller(lines[i])) break;
    }
    // Upwards: over the decorator block and the comments that document it, stopping
    // at the previous member's signature.
    for (let i = index - 1; i >= 0; i -= 1) {
      if (isDecorator(lines[i])) block.push(lines[i]);
      else if (!isFiller(lines[i])) break;
    }
    return block.join('\n');
  };

  const controllers = globSync(resolve(root, 'backend/src/**/*.controller.ts'));
  assert.ok(controllers.length > 10, 'the controllers must actually be found');

  const ungated = [];
  for (const file of controllers) {
    const source = readFileSync(file, 'utf8');
    // Only `RbacGuard` enforces the metadata requirement. A controller guarded by
    // something else — `OptionalJwtAuthGuard` on the bootstrap payload, for one — is
    // a deliberate surface, and a route there is not missing a gate.
    const classDecorators = source.slice(0, source.search(/\nexport class/) + 1);
    if (!/@UseGuards\([^)]*RbacGuard/.test(classDecorators)) continue;

    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const route = /^\s*@(Get|Post|Put|Patch|Delete)\(/.exec(line);
      if (!route) return;

      const block = decoratorsAround(lines, index);
      const gated =
        /@Permissions\(/.test(block) ||
        /@Roles\(/.test(block) ||
        /@AllowAuthenticated\(/.test(block) ||
        /@Public\(/.test(block);

      if (!gated) {
        ungated.push(`${file.replace(`${root}/`, '')}:${index + 1}  ${route[1].toUpperCase()}  ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    ungated,
    [],
    'a route with no gate is refused at runtime by the fail-closed guard, which makes the ' +
      'endpoint dead rather than obvious. Name what it requires:\n' + ungated.join('\n'),
  );
});

test('FC-SEC-013 — role definition is SuperAdmin-only, role assignment is permission-gated', () => {
  const service = read('backend/src/users/users.service.ts');

  // Editing what a role can do is role management and stays SuperAdmin-only.
  assert.match(service, /private assertSuperAdmin/);
  for (const method of ['async createRole', 'async updateRolePermissions', 'async deleteRole']) {
    const start = service.indexOf(method);
    assert.notEqual(start, -1, `${method} must exist`);
    const body = service.slice(start, service.indexOf('\n  async ', start + 10) || undefined);
    assert.match(body, /this\.assertSuperAdmin\(actor\)/, `${method} must stay SuperAdmin-only`);
  }

  // Assigning a role to a user is user management, gated by users.create /
  // users.update, with the two rules that actually protect the system in place
  // of the blanket SuperAdmin requirement that made an Admin's grant inert.
  assert.match(service, /private async assertRoleSelection/);
  assert.match(service, /You cannot change your own role\./);
  assert.match(service, /Only SuperAdmin can grant the SuperAdmin role\./);
  assert.match(service, /await this\.assertRoleSelection\(dto, actor, id\)/);
  assert.doesNotMatch(
    service,
    /assertRoleSelection\([\s\S]{0,200}this\.assertSuperAdmin\(actor\)/,
    'role selection must not fall back to the blanket SuperAdmin check',
  );
});

test('transaction mutations require request idempotency', () => {
  const controller = read('backend/src/transaction/transaction.controller.ts');
  const service = read('backend/src/transaction/transaction.service.ts');
  const schema = read('backend/prisma/schema.prisma');
  const migration = read('backend/prisma/migrations/20260925090000_add_idempotency_records/migration.sql');
  assert.match(controller, /Headers\('idempotency-key'\)/);
  assert.match(service, /executeIdempotently/);
  assert.match(service, /Serializable/);
  assert.match(schema, /model IdempotencyRecord/);
  assert.match(migration, /CREATE UNIQUE INDEX "idempotency_records_actorId_operation_key_key"/);
});

test('offline queue is owner-bound and service worker cannot replay it', () => {
  const queue = read('frontend/src/services/mutationQueueService.ts');
  const sync = read('frontend/src/hooks/useOfflineSync.ts');
  const worker = read('frontend/public/sw.js');
  const app = read('frontend/src/App.tsx');
  const permissions = read('frontend/src/hooks/usePermissions.ts');
  assert.match(queue, /ownerUserId/);
  assert.match(queue, /quarantineOwner/);
  assert.match(queue, /['"]conflict['"]/);
  assert.match(sync, /mutationQueueService\.quarantineOwner/);
  assert.doesNotMatch(worker, /DYNAMIC_CACHE/);
  assert.doesNotMatch(worker, /processMutationQueue/);
  assert.doesNotMatch(app, /ROLE_BASED_FALLBACK_PERMISSIONS|resolveRoleFallbackPermissions/);
  assert.doesNotMatch(permissions, /ROLE_BASED_FALLBACK_PERMISSIONS|resolveRoleFallbackPermissions/);
});

test('the application bootstrap is not a public endpoint (#17)', () => {
  // This guard used to be blessed *by name* in the sweep above, as "a deliberate
  // surface". It returned `true` even when authentication threw, and
  // `AppBootstrapService` had a branch that assembled the payload for `request.user
  // === undefined`. Measured against the running server with no credentials at all:
  // HTTP 200, the reference dictionary, every unloading rule with its
  // `penalty_rate_per_minute`, and three counts disclosing whether data exists.
  //
  // The comment that excused it was the defect's best disguise: a hole with a rationale
  // reads as a decision, and nobody re-opens a decision.
  const controller = read('backend/src/app-bootstrap/app-bootstrap.controller.ts');
  const service = read('backend/src/app-bootstrap/app-bootstrap.service.ts');

  // Matched on the decorator, not the bare name: the controller's comment explains why
  // this guard is the wrong one, and a check that reads prose is a check that can be
  // satisfied by an explanation instead of by code.
  assert.doesNotMatch(controller, /@UseGuards\([^)]*OptionalJwtAuthGuard/,
    'this guard authenticates nothing: it returns true on a failed authentication');
  assert.match(controller, /@UseGuards\(JwtAuthGuard\)/);

  // And the service must refuse a missing principal on its own, so a future caller that
  // reaches it without the guard cannot assemble the payload for a stranger.
  assert.match(service, /if \(!userId\)[\s\S]{0,200}UnauthorizedException/);

  // The guard must not be reintroduced anywhere under a new name either.
  const optional = globSync(resolve(root, 'backend/src/**/*.ts'))
    .filter((file) => /@UseGuards\([^)]*OptionalJwtAuthGuard/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(
    optional.map((file) => file.replace(root, '.')),
    [],
    'OptionalJwtAuthGuard returns true when authentication fails; a route behind it is unguarded',
  );
});

test('PDF rendering is bounded and blocks external requests', () => {
  const dto = read('backend/src/report/dto/print-report.dto.ts');
  const service = read('backend/src/report/report.service.ts');
  assert.match(dto, /@MaxLength\(2_000_000\)/);
  assert.match(service, /setRequestInterception\(true\)/);
  assert.match(service, /TOO_MANY_REQUESTS/);
  assert.match(service, /%PDF-/);
});

test('CI has mandatory typecheck, audit, test, build, and compose gates', () => {
  // FC-QA-001 consolidated the gate list into `npm run ci:verify`, so the
  // workflow delegates instead of repeating the steps. The gate list itself is
  // now asserted in scripts/audit/tests/qa-001-contract.test.mjs; this test
  // keeps the same guarantee from the security angle: the verify workflow must
  // call the shared gate, and nothing may soften a failure.
  const workflow = read('.github/workflows/main.yml');
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.match(workflow, /npm run ci:verify/,
    'the push/pull_request workflow must run the shared verify gate');
  assert.match(scripts['ci:verify'], /typecheck/);
  assert.match(scripts['ci:verify'], /test:audit/);
  assert.match(scripts['ci:verify'], /test:unit/);
  assert.match(scripts['ci:verify'], /build:full/);
  assert.match(scripts['ci:verify'], /compose config/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});
