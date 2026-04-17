import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAuditConfig, redactSensitiveValue, severityRank } from '../shared.mjs';
import { calculateScore } from '../render-audit-report.mjs';
import {
  calculateNormalizedLineSimilarity,
  extractControllerEndpoints,
  isPublicEndpointAllowed,
} from '../run-static-audit.mjs';

const config = loadAuditConfig(new URL('../audit.config.json', import.meta.url));

test('severity ranking preserves critical over high', () => {
  assert.ok(severityRank('critical') > severityRank('high'));
  assert.ok(severityRank('high') > severityRank('medium'));
});

test('secret redaction hides configured values', () => {
  const redacted = redactSensitiveValue('JWT_SECRET: super-secret-value', config);
  assert.equal(redacted, 'JWT_SECRET: [REDACTED]');
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
