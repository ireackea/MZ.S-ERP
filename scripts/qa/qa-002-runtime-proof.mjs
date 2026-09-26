/**
 * FC-QA-002 — disposable runtime and real E2E proof.
 *
 * This script produces **evidence, not claims**: every step records the HTTP
 * status and the response body it actually received, plus DB row counts before
 * and after, so the result can be re-checked by someone who does not trust the
 * summary. Readiness is polled rather than assumed — a fixed sleep would let a
 * half-booted stack look healthy.
 *
 * Usage (from the repo root):
 *   node scripts/qa/qa-002-runtime-proof.mjs
 *   E2E_BASE_URL=http://localhost:3001 node scripts/qa/qa-002-runtime-proof.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const backendUrl = (process.env.E2E_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const metricsToken = process.env.E2E_METRICS_AUTH_TOKEN || process.env.METRICS_AUTH_TOKEN || readEnv('METRICS_AUTH_TOKEN');
const username = process.env.E2E_USERNAME || 'superadmin';
const password = process.env.E2E_PASSWORD || 'SecurePassword2026!';
const outDir = process.env.QA_OUT_DIR || join(repoRoot, '.hermes', 'proof', 'QA-002');
const restorePin = process.env.BACKUP_RESTORE_PIN || readEnv('BACKUP_RESTORE_PIN') || '';

function readEnv(key) {
  for (const file of ['.env', join('backend', '.env')]) {
    try {
      const line = readFileSync(join(repoRoot, file), 'utf8')
        .split(/\r?\n/)
        .find((entry) => entry.startsWith(`${key}=`));
      if (line) return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
    } catch { /* the file is optional */ }
  }
  return undefined;
}

const steps = [];
let cookie = '';

const record = (name, extra = {}) => {
  const entry = { name, at: new Date().toISOString(), ...extra };
  steps.push(entry);
  const flag = extra.ok === false ? 'FAIL' : 'ok';
  const detail = extra.note || extra.status || '';
  console.log(`[${flag}] ${name}${detail !== '' ? ` — ${detail}` : ''}`);
  return entry;
};

async function http(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (cookie) init.headers.Cookie = cookie;

  const started = Date.now();
  const response = await fetch(`${backendUrl}${path}`, init);
  const text = await response.text();
  const setCookie = response.headers.get('set-cookie');
  if (setCookie && /feed_factory_jwt=/.test(setCookie)) {
    cookie = setCookie.split(';')[0];
  }

  let parsed = null;
  if (!raw) {
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  }

  return {
    status: response.status,
    ms: Date.now() - started,
    headers: {
      'content-type': response.headers.get('content-type') || '',
      'set-cookie': setCookie ? 'present' : 'absent',
      'x-metrics-token-echo': response.headers.get('x-backup-checksum') || '',
    },
    body: raw ? text.slice(0, 400) : parsed ?? text.slice(0, 400),
    text,
  };
}

const idem = () => `qa002-${Math.random().toString(36).slice(2, 12)}`;

/** Row counts straight from PostgreSQL, so "the write persisted" is not a claim. */
function dbCounts() {
  const user = readEnv('POSTGRES_USER');
  const db = readEnv('POSTGRES_DB');
  const sql = [
    "select 'items' as t, count(*) from \"Item\"",
    "select 'transactions', count(*) from \"Transaction\"",
    "select 'audit_logs', count(*) from audit_logs",
  ].join(' union all ');
  try {
    const out = execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', db, '-t', '-A', '-F', '|', '-c', sql],
      { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 },
    );
    const counts = {};
    for (const line of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const [table, count] = line.split('|');
      if (table && count) counts[table] = Number(count);
    }
    return counts;
  } catch (error) {
    return { error: String(error.message).slice(0, 200) };
  }
}

/** Container status, so a green HTTP result cannot hide an unhealthy container. */
function containerStatus() {
  try {
    return execFileSync('docker', ['compose', 'ps', '--format', '{{.Service}}|{{.Status}}'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 30_000,
    }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (error) {
    return [`error: ${String(error.message).slice(0, 160)}`];
  }
}

async function waitForReadiness() {
  const deadline = Date.now() + 180_000;
  const attempts = [];
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendUrl}/api/health`);
      const body = await response.json();
      attempts.push({ ms: Date.now(), status: response.status, dbConnected: body?.dbConnected });
      if (response.status === 200 && body?.dbConnected === true) {
        record('readiness: /api/health reports healthy with a live DB', {
          status: response.status,
          ok: true,
          note: `ready after ${attempts.length} poll(s); no fixed sleep was used`,
          attempts,
          body,
        });
        return true;
      }
    } catch (error) {
      attempts.push({ error: String(error.message).slice(0, 120) });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  record('readiness: /api/health never became ready', { ok: false, attempts });
  return false;
}

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  console.log(`FC-QA-002 runtime proof against ${backendUrl}\n`);

  if (!await waitForReadiness()) {
    finish();
    process.exitCode = 1;
    return;
  }

  const before = dbCounts();
  record('DB row counts before', { before });

  // 1. Metrics must be closed without a token, and open with it.
  const noToken = await http('/metrics');
  record('metrics without a token is refused', {
    status: noToken.status, ok: noToken.status === 401, body: noToken.body,
  });

  const wrongToken = await http('/metrics', { headers: { 'x-metrics-token': 'not-the-token' } });
  record('metrics with a wrong token is refused', {
    status: wrongToken.status, ok: wrongToken.status === 401, body: wrongToken.body,
  });

  const withToken = await http('/metrics', { headers: { 'x-metrics-token': metricsToken }, raw: true });
  record('metrics with the real token answers', {
    status: withToken.status,
    ok: withToken.status === 200 && /process_uptime_seconds/.test(withToken.text),
    note: 'Prometheus text format',
    body: withToken.body,
  });

  // 2. Login yields an httpOnly cookie, not a usable token in the body.
  const login = await http('/api/auth/login', {
    method: 'POST', body: { username, password },
  });
  record('login returns 2xx and sets the session cookie', {
    status: login.status,
    ok: login.status === 201 || login.status === 200,
    note: 'cookie is the only credential; the body token is the literal string "httpOnly"',
    body: { ...login.body, user: login.body?.user?.username, permissions: login.body?.user?.permissions?.length },
  });

  const me = await http('/api/auth/me');
  record('the session resolves to a principal', {
    status: me.status, ok: me.status === 200, body: me.body,
  });

  const noCookie = await (async () => {
    const saved = cookie;
    cookie = '';
    const result = await http('/api/items');
    cookie = saved;
    return result;
  })();
  record('a protected route refuses an anonymous caller', {
    status: noCookie.status, ok: noCookie.status === 401, body: noCookie.body,
  });

  const bootstrap = await http('/api/app/bootstrap');
  record('bootstrap reports startup flags', {
    status: bootstrap.status,
    ok: bootstrap.status === 200,
    body: bootstrap.body?.startupFlags ?? bootstrap.body,
  });

  // 3. A real item, then real movements against it.
  const suffix = Math.random().toString(36).slice(2, 8);
  const itemPublicId = `qa002-item-${suffix}`;
  const created = await http('/api/items', {
    method: 'POST',
    body: {
      publicId: itemPublicId,
      name: `QA-002 item ${suffix}`,
      code: `QA002-${suffix}`,
      unit: 'ton',
      category: 'raw',
      minLimit: '0',
      maxLimit: '999999999.999',
    },
  });
  record('item created', {
    status: created.status, ok: created.status === 201,
    body: { publicId: created.body?.publicId, minLimit: created.body?.minLimit, maxLimit: created.body?.maxLimit, currentStock: created.body?.currentStock },
  });

  const decimalsAreStrings = typeof created.body?.maxLimit === 'string';
  record('item decimals are serialized as strings, not floats', {
    ok: decimalsAreStrings,
    note: decimalsAreStrings ? 'FC-DATA-001 wire form holds on the live API' : 'a Decimal column leaked as a JSON number',
    body: { minLimit: created.body?.minLimit, maxLimit: created.body?.maxLimit, currentStock: created.body?.currentStock },
  });

  const afterCreate = dbCounts();
  record('DB row count moved by exactly one item', {
    ok: typeof afterCreate.items === 'number' && afterCreate.items === (before.items ?? 0) + 1,
    note: `items ${before.items} -> ${afterCreate.items}`,
    body: { before: before.items, after: afterCreate.items },
  });

  const today = new Date().toISOString().slice(0, 10);
  const movements = [];
  for (const [type, quantity] of [['وارد', '10.5'], ['صادر', '0.5']]) {
    const result = await http('/api/transactions', {
      method: 'POST',
      headers: { 'Idempotency-Key': idem() },
      body: { date: today, itemId: itemPublicId, type, quantity, supplierOrReceiver: `QA-002 ${type}` },
    });
    movements.push(result);
    record(`movement ${type} ${quantity} accepted`, {
      status: result.status,
      ok: result.status === 200 || result.status === 201,
      body: { quantity: result.body?.quantity, type: result.body?.type },
    });
  }

  // A fresh key per run: reusing a key with a different payload is a 409 by
  // design, which would make this replay check meaningless across runs.
  const replayKey = `qa002-replay-${suffix}`;
  const replay = await http('/api/transactions', {
    method: 'POST',
    headers: { 'Idempotency-Key': replayKey },
    body: { date: today, itemId: itemPublicId, type: 'وارد', quantity: '1.25', supplierOrReceiver: 'QA-002 replay' },
  });
  const replayed = await http('/api/transactions', {
    method: 'POST',
    headers: { 'Idempotency-Key': replayKey },
    body: { date: today, itemId: itemPublicId, type: 'وارد', quantity: '1.25', supplierOrReceiver: 'QA-002 replay' },
  });
  record('replaying an Idempotency-Key does not double-post', {
    status: replayed.status,
    ok: replay.body?.id === replayed.body?.id && (replay.status === replayed.status),
    note: `first=${replay.status}/${replay.body?.id} replay=${replayed.status}/${replayed.body?.id}`,
    body: { firstId: replay.body?.id, replayId: replayed.body?.id },
  });

  const conflicting = await http('/api/transactions', {
    method: 'POST',
    headers: { 'Idempotency-Key': replayKey },
    body: { date: today, itemId: itemPublicId, type: 'وارد', quantity: '9.99', supplierOrReceiver: 'QA-002 different payload' },
  });
  record('reusing a key with a different payload is refused', {
    status: conflicting.status, ok: conflicting.status === 409, body: conflicting.body,
  });

  const detail = await http(`/api/items/${itemPublicId}`);
  const onHand = String(detail.body?.currentStock);
  record('the ledger balances: 10.5 received minus 0.5 issued plus 1.25 replayed once', {
    ok: onHand === '11.250',
    note: `currentStock=${onHand} (a float would have produced 11.249999999999998)`,
    body: { currentStock: detail.body?.currentStock },
  });

  const balances = await http('/api/balances/computed');
  record('computed balances respond', {
    status: balances.status, ok: balances.status === 200,
    body: balances.body,
  });

  const reports = await http(`/api/reports?startDate=${today}&endDate=${today}&page=1&limit=10`);
  record('reports accept real filtering and pagination', {
    status: reports.status, ok: reports.status === 200,
    body: { total: reports.body?.total, page: reports.body?.page, limit: reports.body?.limit },
  });

  const audit = await http('/api/audit/logs?limit=5&offset=0');
  record('audit log is readable and paginated', {
    status: audit.status, ok: audit.status === 200,
    note: `total=${audit.body?.total}`,
    body: { total: audit.body?.total, limit: audit.body?.limit, firstAction: audit.body?.rows?.[0]?.action },
  });

  const auditAfterMoves = await http('/api/audit/logs?limit=5&offset=0&entityType=Transaction');
  record('the movements are in the audit trail', {
    status: auditAfterMoves.status,
    ok: auditAfterMoves.status === 200 && (auditAfterMoves.body?.total ?? 0) > 0,
    note: `transaction audit rows=${auditAfterMoves.body?.total}`,
    body: { total: auditAfterMoves.body?.total },
  });

  // 4. Backup and restore over real HTTP.
  const backup = await http('/api/backup/full', { method: 'POST', body: {} });
  record('a full backup is created', {
    status: backup.status, ok: backup.status === 200 || backup.status === 201, body: backup.body,
  });

  const list = await http('/api/backup/list');
  const entries = Array.isArray(list.body?.data) ? list.body.data : [];
  const latest = entries[0];
  const backupId = latest?.id;
  record('the newest backup is present and integrity-verified', {
    status: list.status,
    ok: list.status === 200 && entries.length > 0 && latest?.integrity === 'verified',
    note: `entries=${entries.length}, newest integrity=${latest?.integrity}, size=${latest?.sizeBytes}`,
    body: { count: entries.length, newest: latest },
  });

  if (backupId && restorePin) {
    const preview = await http('/api/backup/restore', {
      method: 'POST', body: { backupId, restorePin, confirmRestore: false },
    });
    // The controller nests the service result under `data`.
    const previewData = preview.body?.data;
    const restoreToken = previewData?.restoreToken;
    record('restore preview issues a token and takes a safety snapshot', {
      status: preview.status,
      ok: preview.status === 200
        && preview.body?.stage === 'preview'
        && Boolean(restoreToken)
        && Boolean(previewData?.safetySnapshotId),
      note: 'a restore may not proceed without the one-time token from this preview',
      body: {
        stage: preview.body?.stage,
        requiresConfirmation: previewData?.requiresConfirmation,
        hasRestoreToken: Boolean(restoreToken),
        safetySnapshotId: previewData?.safetySnapshotId,
        target: previewData?.target,
      },
    });

    const noToken = await http('/api/backup/restore', {
      method: 'POST', body: { backupId, restorePin, confirmRestore: true },
    });
    record('a restore without the confirmation token is refused', {
      status: noToken.status,
      ok: noToken.status >= 400,
      note: 'confirmRestore alone must never be enough to wipe the database',
      body: noToken.body,
    });

    const wrongPin = await http('/api/backup/restore', {
      method: 'POST', body: { backupId, restorePin: 'definitely-not-the-pin', confirmRestore: false },
    });
    record('a restore with the wrong PIN is refused', {
      status: wrongPin.status, ok: wrongPin.status === 401, body: wrongPin.body,
    });

    const applied = await http('/api/backup/restore', {
      method: 'POST',
      body: { backupId, restorePin, confirmRestore: true, restoreToken },
    });
    const afterRestore = dbCounts();
    record('restore applies against the live database', {
      status: applied.status,
      ok: applied.status === 200 && applied.body?.success === true && applied.body?.stage === 'applied',
      note: `items ${afterCreate.items} -> ${afterRestore.items}`,
      body: { success: applied.body?.success, stage: applied.body?.stage, data: applied.body?.data, counts: afterRestore },
    });
  } else {
    record('restore cannot be exercised: BACKUP_RESTORE_PIN is not configured', {
      ok: false,
      note: 'the restore endpoint answers 401 "Restore PIN is not configured", so the destructive path stays unproven at runtime',
      body: { backupId, restorePinConfigured: Boolean(restorePin) },
    });
  }

  // 5. Logout must actually end the session.
  const logout = await http('/api/auth/logout', { method: 'POST' });
  record('logout succeeds', { status: logout.status, ok: logout.status === 200 || logout.status === 201, body: logout.body });

  const afterLogout = await http('/api/auth/me');
  record('the session is dead after logout', {
    status: afterLogout.status, ok: afterLogout.status === 401, body: afterLogout.body,
  });

  const containers = containerStatus();
  record('container health at the end of the run', {
    containers,
    note: containers.join(' | '),
  });

  finish();
};

function finish() {
  const after = dbCounts();
  const failed = steps.filter((s) => s.ok === false);
  const artifact = {
    card: 'FC-QA-002',
    generatedAt: new Date().toISOString(),
    backendUrl,
    dbCounts: { after },
    totals: { steps: steps.length, failed: failed.length },
    steps,
  };
  const file = join(outDir, 'http-proof.json');
  writeFileSync(file, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(`\n${steps.length} step(s), ${failed.length} failure(s)`);
  console.log(`evidence: ${file}`);
  for (const step of failed) console.log(`  FAILED: ${step.name} — ${step.note || step.status || ''}`);
  if (failed.length) process.exitCode = 1;
}

await main();
