#!/usr/bin/env node
/**
 * Surgical Cloud Audit Protocol – FeedFactory Pro ERP
 * ====================================================
 * Audits the running system by performing:
 *  1. Backend health check
 *  2. Authentication (login + JWT validation)
 *  3. Core endpoint smoke tests
 *  4. Rate-limit header validation
 *  5. CORS header validation
 *  6. Final audit report generation (JSON + human-readable)
 *
 * Usage:
 *   node scripts/cloud-audit.mjs
 *   AUDIT_BASE_URL=http://localhost:3001 node scripts/cloud-audit.mjs
 *   AUDIT_BASE_URL=https://<codespace>-3001.app.github.dev node scripts/cloud-audit.mjs
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Environment loading
// ---------------------------------------------------------------------------
function loadEnvSync(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch {
    // file not found – ignore
  }
}

loadEnvSync(path.join(ROOT_DIR, 'backend', '.env'));
loadEnvSync(path.join(ROOT_DIR, '.env'));
loadEnvSync(path.join(ROOT_DIR, '.env.local'));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = (
  process.env.AUDIT_BASE_URL ||
  (process.env.VITE_API_URL || '').replace(/\/api$/, '') ||
  'http://localhost:3001'
).replace(/\/$/, '');

const USERNAME = process.env.AUDIT_USERNAME || process.env.ADMIN_USERNAME || 'superadmin';
const PASSWORD = process.env.AUDIT_PASSWORD || process.env.ADMIN_PASSWORD || 'SecurePassword2026!';
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 10000);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const results = [];

function record(check, status, detail = '') {
  results.push({ check, status, detail, ts: new Date().toISOString() });
  const icon = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : '⚠️  WARN';
  const detailStr = detail ? ` — ${detail}` : '';
  console.log(`  ${icon}  ${check}${detailStr}`);
}

async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Audit Steps
// ---------------------------------------------------------------------------

/** Step 1 – Backend Health Check */
async function checkHealth() {
  console.log('\n[1/5] Backend Health Check');
  const url = `${BASE_URL}/api/health`;
  try {
    const res = await safeFetch(url);
    if (!res.ok) {
      record('Health endpoint HTTP status', 'FAIL', `HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    record('Health endpoint reachable', 'PASS', `HTTP ${res.status}`);
    record('Health status field', body.status === 'healthy' ? 'PASS' : 'WARN', body.status ?? 'missing');
    record('DB connected', body.dbConnected ? 'PASS' : 'WARN', String(body.dbConnected ?? 'unknown'));
    return body;
  } catch (err) {
    record('Health endpoint reachable', 'FAIL', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Step 2 – Authentication Audit */
async function checkAuth() {
  console.log('\n[2/5] Authentication Audit');
  let token = null;

  // Valid login
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.accessToken) {
      record('Login with valid credentials', 'PASS', `HTTP ${res.status}`);
      token = body.accessToken;
    } else {
      record('Login with valid credentials', 'FAIL', `HTTP ${res.status} – ${body.message ?? 'no token'}`);
    }
  } catch (err) {
    record('Login with valid credentials', 'FAIL', err instanceof Error ? err.message : String(err));
  }

  // Invalid login must return 401
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: 'WRONG_PASSWORD_AUDIT_TEST' }),
    });
    record('Wrong password returns 401', res.status === 401 ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
  } catch (err) {
    record('Wrong password returns 401', 'FAIL', err instanceof Error ? err.message : String(err));
  }

  // Protected route without token must return 401
  try {
    const res = await safeFetch(`${BASE_URL}/api/users`);
    record('Unauthenticated request rejected', res.status === 401 ? 'PASS' : 'WARN', `HTTP ${res.status}`);
  } catch (err) {
    record('Unauthenticated request rejected', 'FAIL', err instanceof Error ? err.message : String(err));
  }

  // Protected route with valid token
  if (token) {
    try {
      const res = await safeFetch(`${BASE_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      record('Authenticated request accepted', res.ok ? 'PASS' : 'FAIL', `HTTP ${res.status}`);
    } catch (err) {
      record('Authenticated request accepted', 'FAIL', err instanceof Error ? err.message : String(err));
    }
  }

  return token;
}

/** Step 3 – Core Endpoint Smoke Tests */
async function checkEndpoints(token) {
  console.log('\n[3/5] Core Endpoint Smoke Tests');
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const endpoints = [
    { path: '/api/health',       method: 'GET',  auth: false, label: 'Health endpoint'        },
    { path: '/api/items',        method: 'GET',  auth: true,  label: 'Items list endpoint'    },
    { path: '/api/dashboard',    method: 'GET',  auth: true,  label: 'Dashboard endpoint'     },
    { path: '/api/transactions', method: 'GET',  auth: true,  label: 'Transactions endpoint'  },
    { path: '/api/reports',      method: 'GET',  auth: true,  label: 'Reports endpoint'       },
    { path: '/api/users',        method: 'GET',  auth: true,  label: 'Users endpoint'         },
  ];

  for (const ep of endpoints) {
    const headers = ep.auth ? { ...authHeader } : {};
    try {
      const res = await safeFetch(`${BASE_URL}${ep.path}`, { method: ep.method, headers });
      const expectedOk = ep.auth ? (token ? res.ok : res.status === 401) : res.status < 500;
      record(ep.label, expectedOk ? 'PASS' : 'WARN', `HTTP ${res.status}`);
    } catch (err) {
      record(ep.label, 'FAIL', err instanceof Error ? err.message : String(err));
    }
  }
}

/** Step 4 – Rate-Limit Header Validation */
async function checkRateLimitHeaders() {
  console.log('\n[4/5] Rate-Limit Header Validation');
  try {
    const res = await safeFetch(`${BASE_URL}/api/health`);
    record('X-RateLimit-Limit header',     res.headers.has('x-ratelimit-limit')     ? 'PASS' : 'WARN');
    record('X-RateLimit-Remaining header', res.headers.has('x-ratelimit-remaining') ? 'PASS' : 'WARN');
    record('X-RateLimit-Reset header',     res.headers.has('x-ratelimit-reset')     ? 'PASS' : 'WARN');
  } catch (err) {
    record('Rate-limit headers check', 'FAIL', err instanceof Error ? err.message : String(err));
  }
}

/** Step 5 – CORS Header Validation */
async function checkCORS() {
  console.log('\n[5/5] CORS Header Validation');

  const testOrigins = [
    { origin: 'http://localhost:5173', expectAllow: true,  label: 'localhost:5173 (dev frontend)' },
    { origin: 'https://evil.example.com', expectAllow: false, label: 'evil.example.com (blocked)' },
  ];

  for (const { origin, expectAllow, label } of testOrigins) {
    try {
      const res = await safeFetch(`${BASE_URL}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
        },
      });
      const acao = res.headers.get('access-control-allow-origin') ?? '';
      const isAllowed = acao === '*' || acao === origin || acao.includes(origin);

      if (expectAllow) {
        record(`CORS allows ${label}`, isAllowed ? 'PASS' : 'WARN', `ACAO: "${acao}"`);
      } else {
        record(`CORS blocks ${label}`, !isAllowed ? 'PASS' : 'WARN', `ACAO: "${acao}"`);
      }
    } catch (err) {
      record(`CORS check for ${label}`, 'WARN', err instanceof Error ? err.message : String(err));
    }
  }
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------
async function generateReport() {
  const passed  = results.filter((r) => r.status === 'PASS').length;
  const failed  = results.filter((r) => r.status === 'FAIL').length;
  const warned  = results.filter((r) => r.status === 'WARN').length;
  const total   = results.length;
  const overallStatus = failed > 0 ? 'FAILED' : warned > 0 ? 'DEGRADED' : 'HEALTHY';

  const report = {
    protocol: 'Surgical Cloud Audit',
    system: 'FeedFactory Pro ERP',
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    summary: { total, passed, failed, warned, overallStatus },
    results,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportsDir = path.join(ROOT_DIR, 'logs');
  mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, `cloud-audit-${timestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const sep  = '='.repeat(72);
  const sep2 = '-'.repeat(72);
  const humanLines = [
    sep,
    '  Surgical Cloud Audit Report – FeedFactory Pro ERP',
    `  Generated : ${report.generatedAt}`,
    `  Base URL  : ${BASE_URL}`,
    sep,
    '',
    `  Overall Status : ${overallStatus}`,
    `  Total Checks   : ${total}`,
    `  Passed         : ${passed}`,
    `  Failed         : ${failed}`,
    `  Warnings       : ${warned}`,
    '',
    sep2,
    '  Detailed Results',
    sep2,
    ...results.map((r) => {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️ ';
      const detail = r.detail ? ` — ${r.detail}` : '';
      return `  ${icon}  [${r.status.padEnd(4)}] ${r.check}${detail}`;
    }),
    '',
    sep,
  ];

  const humanPath = path.join(reportsDir, `cloud-audit-${timestamp}.txt`);
  writeFileSync(humanPath, humanLines.join('\n'), 'utf8');

  return { report, jsonPath, humanPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('');
  console.log('='.repeat(72));
  console.log('  🔍 Surgical Cloud Audit Protocol – FeedFactory Pro ERP');
  console.log(`  Target : ${BASE_URL}`);
  console.log(`  User   : ${USERNAME}`);
  console.log('='.repeat(72));

  await checkHealth();
  const token = await checkAuth();
  await checkEndpoints(token);
  await checkRateLimitHeaders();
  await checkCORS();

  const { report, jsonPath, humanPath } = await generateReport();
  const { summary } = report;

  console.log('');
  console.log('='.repeat(72));
  console.log('  📋 Audit Complete');
  console.log(`  Overall Status : ${summary.overallStatus}`);
  console.log(`  Passed: ${summary.passed} | Failed: ${summary.failed} | Warnings: ${summary.warned}`);
  console.log(`  JSON report : ${jsonPath}`);
  console.log(`  Text report : ${humanPath}`);
  console.log('='.repeat(72));
  console.log('');

  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Audit script error:', err);
  process.exitCode = 1;
});
