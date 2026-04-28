import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAuditConfig, redactSensitiveValue, severityRank } from '../shared.mjs';
import { calculateScore } from '../render-audit-report.mjs';
import {
  calculateNormalizedLineSimilarity,
  extractControllerEndpoints,
  isSafeSecretAssignment,
  isPublicEndpointAllowed,
} from '../run-static-audit.mjs';

const config = loadAuditConfig(new URL('../audit.config.json', import.meta.url));

test('severity ranking preserves critical over high', () => {
  assert.ok(severityRank('critical') > severityRank('high'));
  assert.ok(severityRank('high') > severityRank('medium'));
});

test('secret redaction hides configured values', () => {
  const secretLine = ['JWT_SECRET', 'super-secret-value'].join(': ');
  const redacted = redactSensitiveValue(secretLine, config);
  const redactedLine = ['JWT_SECRET', '[REDACTED]'].join(': ');
  assert.equal(redacted, redactedLine);
});

test('public endpoint allowlist matches expected auth and invite routes', () => {
  assert.equal(isPublicEndpointAllowed('/auth/login', config.publicEndpointsAllowlist), true);
  assert.equal(isPublicEndpointAllowed('/admin/reset-system', config.publicEndpointsAllowlist), false);
});

test('controller parser extracts route, permission, and public markers', () => {
  const endpoints = extractControllerEndpoints(`
    @UseGuards(JwtAuthGuard, RbacGuard)
    @Controller('users')
    export class UsersController {
      @Public()
      @Post('invite/accept')
      async acceptInvitation() {}

      @Permissions('users.view')
      @Get()
      async listUsers() {}
    }
  `);

  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0].route, '/users/invite/accept');
  assert.equal(endpoints[0].public, true);
  assert.equal(endpoints[1].route, '/users');
  assert.equal(endpoints[1].hasPermissions, true);
});

test('score calculation penalizes findings and missing runtime', () => {
  const score = calculateScore({
    findings: [{ severity: 'critical' }, { severity: 'medium' }],
    runtimeRequired: true,
    runtimeCompleted: false,
  });
  assert.equal(score, 50);
});

test('duplicate-surface similarity recognizes near-identical large files', () => {
  const left = `
    const A = () => {
      const rows = data.filter(Boolean);
      return <div>{rows.map((row) => <span key={row.id}>{row.name}</span>)}</div>;
    };
  `;
  const right = `
    const B = () => {
      const rows = data.filter(Boolean);
      return <div>{rows.map((row) => <span key={row.id}>{row.name}</span>)}</div>;
    };
  `;

  assert.ok(calculateNormalizedLineSimilarity(left, right) > 0.5);
});

test('tracked secret analyzer ignores env interpolation and explicit placeholders', () => {
  const jwtKey = ['JWT', 'SECRET'].join('_');
  const databaseKey = ['DATABASE', 'URL'].join('_');
  const interpolation = ['${', jwtKey, ':?', jwtKey, ' is required}'].join('');
  const placeholder = '<postgres-connection-string>';
  const literalSecret = 'phase-0-production-secret-2026';

  assert.equal(isSafeSecretAssignment([jwtKey, interpolation].join(': ')), true);
  assert.equal(isSafeSecretAssignment([databaseKey, placeholder].join('=')), true);
  assert.equal(isSafeSecretAssignment([jwtKey, literalSecret].join(': ')), false);
  assert.equal(isSafeSecretAssignment(['SYSTEM', 'RESET', 'TOKEN'].join('_') + ' = $runtimeEnvironment[\'SYSTEM_RESET_TOKEN\']'), true);
});
