// ENTERPRISE FIX: Phase 7 - Production Deployment & Monitoring Setup - 2026-03-13
import { describe, expect, it } from 'vitest';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3001';
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';

describe('login and monitoring smoke test', () => {
  it('logs in successfully and exposes Prometheus metrics', async () => {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const loginPayload = await loginResponse.json();

    expect(loginResponse.status).toBe(201);
    expect(String(loginResponse.headers.get('set-cookie') || '')).toContain('HttpOnly');
    expect(String(loginResponse.headers.get('set-cookie') || '')).toContain('SameSite=Strict');
    expect(loginPayload.user?.username).toBeTruthy();

    const metricsResponse = await fetch(`${baseUrl}/metrics`);
    const metricsText = await metricsResponse.text();

    expect(metricsResponse.ok).toBe(true);
    expect(metricsText).toContain('http_requests_total');
    expect(metricsText).toContain('process_uptime_seconds');
  });
});