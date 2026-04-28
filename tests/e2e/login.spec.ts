// ENTERPRISE FIX: Phase 7 - Production Deployment & Monitoring Setup - 2026-03-13
import { describe, expect, it } from 'vitest';
import { backendUrl, e2ePassword as password, getMetricsHeaders, e2eUsername as username } from './support/runtimeConfig';

describe('login and monitoring smoke test', () => {
  it('logs in successfully and exposes Prometheus metrics', async () => {
    const loginResponse = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const loginPayload = await loginResponse.json();

    expect(loginResponse.status).toBe(201);
    expect(String(loginResponse.headers.get('set-cookie') || '')).toContain('HttpOnly');
    expect(String(loginResponse.headers.get('set-cookie') || '')).toContain('SameSite=Strict');
    expect(loginPayload.user?.username).toBeTruthy();

    const metricsResponse = await fetch(`${backendUrl}/metrics`, { headers: getMetricsHeaders() });
    const metricsText = await metricsResponse.text();

    expect(metricsResponse.ok).toBe(true);
    expect(metricsText).toContain('http_requests_total');
    expect(metricsText).toContain('process_uptime_seconds');
  });
});