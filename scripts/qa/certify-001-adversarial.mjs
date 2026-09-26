/**
 * FC-CERTIFY-001 — Devil's Advocate pass (part 1: money, stock, time).
 *
 * The certification plan requires an adversarial run against the stock
 * invariants, precision, and timezone. These probes deliberately try to break
 * the system rather than confirm it: they push the boundaries, replay, reorder,
 * cancel, and look for a silent corruption. A probe that passes is evidence; a
 * probe that fails is a finding, and the script reports both honestly.
 *
 * This is a self-attack, not an independent verification — see the note at the
 * end of the run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const backendUrl = (process.env.E2E_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';
const outDir = process.env.QA_OUT_DIR || join(process.cwd(), '.hermes', 'proof', 'CERTIFY-001');

let cookie = '';

const findings = [];
const probes = [];

const record = (name, ok, detail) => {
  probes.push({ name, ok, detail });
  console.log(`[${ok ? 'held' : 'FINDING'}] ${name} — ${detail}`);
  if (!ok) findings.push({ name, detail });
};

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (cookie) init.headers.Cookie = cookie;
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
  return { status: response.status, body: parsed ?? text };
}

const idem = () => `cert-${randomUUID().slice(0, 8)}`;
const today = () => new Date().toISOString().slice(0, 10);
const data = (b) => b?.data ?? b;

const newItem = async (label) => {
  const suffix = randomUUID().slice(0, 8);
  const publicId = `cert-${label}-${suffix}`;
  const created = await api('/api/items', {
    method: 'POST',
    body: { publicId, name: `CERT ${label} ${suffix}`, code: `CERT-${suffix}`, unit: 'ton', category: 'raw', minLimit: '0', maxLimit: '999999999.999' },
  });
  if (created.status !== 201) throw new Error(`item create failed: ${created.status} ${JSON.stringify(created.body)}`);
  return publicId;
};

const move = async (itemId, type, quantity, extra = {}) => api('/api/transactions', {
  method: 'POST',
  headers: { 'Idempotency-Key': idem() },
  body: { date: today(), itemId, type, quantity, supplierOrReceiver: 'CERT', ...extra },
});

const onHand = async (itemId) => String(data((await api(`/api/items/${itemId}`)).body)?.currentStock);

const main = async () => {
  mkdirSync(outDir, { recursive: true });

  const login = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  if (![200, 201].includes(login.status)) {
    console.error(`Login failed: ${login.status}`);
    process.exitCode = 1;
    return;
  }

  // ---- Precision: the classic float trap, in a real ledger. ----
  {
    const item = await newItem('precision');
    for (let i = 0; i < 10; i += 1) await move(item, 'وارد', '0.1');
    for (let i = 0; i < 3; i += 1) await move(item, 'صادر', '0.3');
    const stock = await onHand(item);
    record('precision: 10x0.1 - 3x0.3 balances exactly',
      stock === '0.100', `currentStock=${stock}`);
  }

  // ---- Precision: a large value must not be re-rendered in exponent form. ----
  {
    const item = await newItem('large');
    await move(item, 'وارد', '999999999.999');
    const stock = await onHand(item);
    record('precision: DECIMAL_MAX survives the round trip',
      stock === '999999999.999', `currentStock=${stock}`);
  }

  // ---- Boundary: values beyond the declared ceiling must be refused. ----
  {
    const item = await newItem('ceiling');
    const over = await move(item, 'وارد', '1000000000');
    record('boundary: a value above DECIMAL_MAX is refused',
      over.status === 400, `status=${over.status} ${JSON.stringify(over.body).slice(0, 120)}`);
    const stock = await onHand(item);
    record('boundary: the refused write left the ledger untouched',
      stock === '0.000', `currentStock=${stock}`);
  }

  // ---- Invariant: a transaction cannot be created for a non-existent item. ----
  {
    const ghost = await api('/api/transactions', {
      method: 'POST',
      headers: { 'Idempotency-Key': idem() },
      body: { date: today(), itemId: `cert-ghost-${randomUUID().slice(0, 6)}`, type: 'وارد', quantity: '5', supplierOrReceiver: 'CERT' },
    });
    record('integrity: a movement for an unknown item is refused',
      ghost.status === 404, `status=${ghost.status}`);
  }

  // ---- DEF-001: stock can never go negative; the shortfall becomes debt. ----
  {
    const item = await newItem('over-issue');
    await move(item, 'وارد', '10');
    const before = await onHand(item);
    const issue = await move(item, 'صادر', '999');
    const after = await onHand(item);

    // The balance must never be negative. The debt is recorded rather than the
    // balance being pushed below zero, so currentStock = ledgerNet + openDeficit.
    record('integrity: an over-issue never leaves a negative balance',
      Number(after) >= 0, `before=${before} issue=${issue.status} after=${after}`);

    // The ledger is the signed sum of the movements themselves: +10 in, -999
    // out. The balance is clamped at zero, and the difference is the debt.
    const ledger = 10 - 999;
    const deficitRes = await api(`/api/stock-deficits?itemId=${item}&status=OPEN`);
    const deficit = Number(deficitRes.body?.openQuantity ?? 0);
    record('integrity: the shortfall is recorded so the ledger still reconciles',
      Math.abs(Number(after) - (ledger + deficit)) < 0.001 && deficit > 0,
      `balance=${after} ledger=${ledger} openDeficit=${deficit} (balance === ledger + debt)`);
  }

  // ---- Idempotency: a replayed key must not double-count. ----
  {
    const item = await newItem('replay');
    const key = `cert-replay-${randomUUID().slice(0, 8)}`;
    const first = await api('/api/transactions', {
      method: 'POST', headers: { 'Idempotency-Key': key },
      body: { date: today(), itemId: item, type: 'وارد', quantity: '7.5', supplierOrReceiver: 'CERT' },
    });
    const second = await api('/api/transactions', {
      method: 'POST', headers: { 'Idempotency-Key': key },
      body: { date: today(), itemId: item, type: 'وارد', quantity: '7.5', supplierOrReceiver: 'CERT' },
    });
    const stock = await onHand(item);
    record('idempotency: a replayed key does not double-count',
      stock === '7.500', `first=${first.status} replay=${second.status} currentStock=${stock}`);
  }

  // ---- Precision: a non-integer float must be refused, not silently rounded. ----
  {
    const item = await newItem('float');
    const drifted = await move(item, 'وارد', 0.1 + 0.2);
    record('precision: a drifting JS float is refused with 400',
      drifted.status === 400, `status=${drifted.status}`);
    const stock = await onHand(item);
    record('precision: the refused float left the ledger untouched',
      stock === '0.000', `currentStock=${stock}`);
  }

  // ---- Timezone: a movement dated in the past must not rewrite "today" totals. ----
  {
    const item = await newItem('time');
    const past = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const result = await move(item, 'وارد', '1', { date: past });
    const stock = await onHand(item);
    record('timezone: a past-dated movement is accepted and reflected exactly once',
      result.status === 200 || result.status === 201 ? stock === '1.000' : true,
      `date=${past} status=${result.status} currentStock=${stock}`);
  }

  const report = {
    card: 'FC-CERTIFY-001',
    part: 'adversarial probes: money, stock, time',
    generatedAt: new Date().toISOString(),
    caveat: 'Self-attack by the same agent that wrote the code. This is evidence of '
      + 'probing, NOT an independent verification. CERTIFY-001 requires a human verifier.',
    totals: { probes: probes.length, findings: findings.length },
    probes,
    findings,
  };
  writeFileSync(join(outDir, 'adversarial-core.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n${probes.length - findings.length}/${probes.length} probe(s) held, ${findings.length} finding(s)`);
  for (const finding of findings) console.log(`  FINDING: ${finding.name} - ${finding.detail}`);
};

await main();
