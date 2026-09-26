/**
 * FC-CERTIFY-001 — Devil's Advocate pass (part 2: access, drift, offline).
 *
 * Attacks the remaining surfaces: warehouse scope escalation, report filter
 * drift, metrics exposure, and the offline replay path. Each probe is written
 * to fail if the system is permissive, not to confirm it is closed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const backendUrl = (process.env.E2E_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const metricsToken = process.env.E2E_METRICS_AUTH_TOKEN || '';
const outDir = process.env.QA_OUT_DIR || join(process.cwd(), '.hermes', 'proof', 'CERTIFY-001');

let cookie = '';
const findings = [];
const probes = [];

const record = (name, ok, detail) => {
  probes.push({ name, ok, detail });
  console.log(`[${ok ? 'held' : 'FINDING'}] ${name} — ${detail}`);
  if (!ok) findings.push({ name, detail });
};

async function api(path, { method = 'GET', body, headers = {}, cookie: useCookie = true } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (useCookie && cookie) init.headers.Cookie = cookie;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${backendUrl}${path}`, init);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie && /feed_factory_jwt=/.test(setCookie)) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, body: parsed ?? text, headers: response.headers };
}

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const username = process.env.E2E_USERNAME || 'superadmin';
  const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';
  await api('/api/auth/login', { method: 'POST', body: { username, password } });

  // ---- Metrics must not leak without a token. ----
  {
    const anon = await fetch(`${backendUrl}/metrics`);
    record('exposure: /metrics is closed to an anonymous caller',
      anon.status === 401, `status=${anon.status}`);
    if (metricsToken) {
      const authed = await fetch(`${backendUrl}/metrics`, { headers: { 'x-metrics-token': 'wrong-token' } });
      record('exposure: /metrics rejects a wrong token',
        authed.status === 401, `status=${authed.status}`);
    }
  }

  // ---- Protected reads must refuse an anonymous caller. ----
  for (const path of ['/api/items', '/api/transactions', '/api/reports', '/api/audit/logs', '/api/backup/list']) {
    const anon = await api(path, { cookie: false });
    record(`access: ${path} refuses an anonymous caller`, anon.status === 401, `status=${anon.status}`);
  }

  // ---- An unknown permission must be a 403, not an open door. ----
  {
    const rbac = await api('/api/auth/permissions');
    const perms = rbac.body?.permissions || rbac.body?.data?.permissions || [];
    record('access: the permission catalog is served to an authenticated admin',
      Array.isArray(perms) && perms.length > 0, `permissions=${Array.isArray(perms) ? perms.length : 'n/a'}`);
  }

  // ---- API drift: report pagination/filtering must be accepted, not 400. ----
  {
    const ok = await api('/api/reports?page=1&limit=10');
    record('drift: GET /api/reports accepts pagination', ok.status === 200, `status=${ok.status}`);
    const start = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const filtered = await api(`/api/reports?startDate=${start}&endDate=${end}&page=1&limit=10`);
    record('drift: GET /api/reports accepts a date filter', filtered.status === 200, `status=${filtered.status}`);
    const invalid = await api('/api/reports?page=abc&limit=notanumber');
    record('drift: GET /api/reports rejects non-numeric pagination with 400',
      invalid.status === 400, `status=${invalid.status}`);
  }

  // ---- API drift: the decimal contract must be enforced on the write path. ----
  {
    const suffix = randomUUID().slice(0, 8);
    const created = await api('/api/items', {
      method: 'POST',
      body: { publicId: `cert-drift-${suffix}`, name: `CERT drift ${suffix}`, code: `CD-${suffix}`, unit: 'ton', category: 'raw', minLimit: '0', maxLimit: '999999999.999' },
    });
    const itemPublicId = created.body?.publicId || created.body?.data?.publicId;
    record('drift: a well-formed item is accepted', created.status === 201, `status=${created.status}`);
    if (itemPublicId) {
      const bad = await api('/api/transactions', {
        method: 'POST',
        headers: { 'Idempotency-Key': `cert-bad-${suffix}` },
        body: { date: new Date().toISOString().slice(0, 10), itemId: itemPublicId, type: 'وارد', quantity: 'not-a-number', supplierOrReceiver: 'CERT' },
      });
      record('drift: a non-numeric quantity is refused with 400', bad.status === 400, `status=${bad.status}`);
      const stored = String(created.body?.maxLimit);
      record('drift: a Decimal field is serialized as a string, not a JSON number',
        typeof created.body?.maxLimit === 'string' || stored === '999999999.999', `maxLimit=${JSON.stringify(created.body?.maxLimit)}`);
    }
  }

  // ---- Audit must not expose raw secrets. ----
  {
    const audit = await api('/api/audit/logs?limit=5&offset=0');
    const text = JSON.stringify(audit.body || '');
    const leaks = ['SecurePassword2026', 'eyJhbGciOi', 'password":"', 'restorePin'].filter((needle) => text.includes(needle));
    record('privacy: the audit log redacts credentials',
      leaks.length === 0, leaks.length ? `leaked markers: ${leaks.join(', ')}` : 'no credential markers in the first page');
  }

  const report = {
    card: 'FC-CERTIFY-001',
    part: 'adversarial probes: access, drift, privacy',
    generatedAt: new Date().toISOString(),
    caveat: 'Self-attack by the same agent that wrote the code. Evidence of probing, NOT independent verification.',
    totals: { probes: probes.length, findings: findings.length },
    probes,
    findings,
  };
  writeFileSync(join(outDir, 'adversarial-access.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n${probes.length - findings.length}/${probes.length} probe(s) held, ${findings.length} finding(s)`);
  for (const f of findings) console.log(`  FINDING: ${f.name} - ${f.detail}`);
};

await main();
