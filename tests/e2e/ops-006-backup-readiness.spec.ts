import { describe, expect, it, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, backupRestorePin, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * B12 — "can I restore my backups on this server?", asked before it is needed.
 *
 * ## The failure
 *
 * The KDF mixed the master secret into every archive's key. So rotating
 * `BACKUP_ENCRYPTION_SECRET` — which any competent operator does after rebuilding a
 * server — made every existing archive undecryptable. The data was intact; the backup
 * system could not read it; and it said «Invalid password or corrupted file», which is
 * the same sentence it uses for a wrong passphrase and for a damaged file.
 *
 * That is the worst shape a backup failure can take: silent until the moment you need
 * it, and then indistinguishable from an operator's typo.
 *
 * ## What this asserts
 *
 * That a live server can be *asked*, and that the answer distinguishes a secret that
 * matches from one that does not. It does not rotate the real secret — that would
 * destroy the deployment's own archives, which is the very failure being made
 * detectable. It asks the live endpoint, checks the shape of what comes back, and then
 * checks the decision function against a genuinely different secret.
 */

const restorePin = backupRestorePin() ?? '';

const hasContainers = (() => {
  try {
    const out = execFileSync('docker', ['compose', 'ps', '--format', '{{.Service}} {{.State}}'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return /backend\s+running/.test(out);
  } catch {
    return false;
  }
})();

const describeLive = hasContainers ? describe : describe.skip;

let cookie = '';
const created: string[] = [];

const login = async () => {
  if (cookie) return cookie;
  const response = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status, 'login failed — is the backend up?').toBe(201);
  cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  return cookie;
};

const api = async (path: string, init: RequestInit = {}) => {
  const session = await login();
  const response = await fetch(`${backendUrl}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: session, ...(init.headers || {}) },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
};

afterAll(() => {
  for (const id of created) {
    spawnSync('curl', ['-s', '-X', 'DELETE', `${backendUrl}/api/backup/${id}`, '-H', `Cookie: ${cookie}`], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  }
});

describeLive('B12 restore readiness on a live server', () => {
  it('answers the question, per archive, with a fingerprint and a scope', async () => {
    const made = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b12-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(made.response.status, JSON.stringify(made.data)).toBe(200);
    const backupId = String(made.data?.data?.id || '');
    expect(backupId).not.toBe('');
    created.push(backupId);

    const readiness = await api('/backup/restore-readiness');
    expect(readiness.response.status, JSON.stringify(readiness.data)).toBe(200);

    const report = readiness.data?.data;
    expect(report).toBeTruthy();
    // A fingerprint, so the answer is about *this* server rather than about a
    // configuration file nobody can see.
    expect(report.currentFingerprint).toMatch(/^[0-9a-f]{12}$/);

    const row = (report.archives || []).find((archive: any) => archive.id === backupId);
    expect(row, 'the archive just taken must appear in the report').toBeTruthy();
    // Just sealed here, so it must be sealed here.
    expect(row.sealedOnThisServer, 'an archive taken seconds ago must be openable on this server').toBe(true);
    expect(row.restorable).toBe(true);
    expect(row.code).toBe('OK');
    // And it records the scope, so a restore knows which protection it is holding
    // rather than discovering it by failing.
    expect(['both', 'archive-only']).toContain(row.keyScope);

    expect(report.counts.total).toBeGreaterThan(0);
    expect(report.overall).toHaveProperty('code');
    expect(report.overall).toHaveProperty('message');
  }, 180_000);

  it('the new archive still restores, so adding a fingerprint changed nothing about opening', async () => {
    // The regression this could have caused: writing a new field into the envelope
    // and changing the KDF call site in the same change. The proof is that an archive
    // taken now behaves exactly as one taken before did.
    const [made] = await Promise.all([
      api('/backup/config', {
        method: 'POST',
        headers: { 'Idempotency-Key': `b12b-${randomUUID()}` },
        body: JSON.stringify({}),
      }),
    ]);
    const backupId = String(made.data?.data?.id || '');
    created.push(backupId);

    const preview = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b12c-${randomUUID()}` },
      body: JSON.stringify({ backupId, restorePin, confirmRestore: false }),
    });

    expect(preview.response.status, JSON.stringify(preview.data)).toBe(200);
    expect(preview.data?.stage).toBe('preview');
    created.push(String(preview.data?.data?.safetySnapshotId || ''));
  }, 180_000);
});

describe('B12 the decision, on a secret that really is different', () => {
  it('names a rotated secret instead of guessing', async () => {
    // Unit-level, because the live server's secret must not be rotated to produce
    // this condition — doing so would destroy the deployment's own archives, which is
    // the failure being made detectable.
    const { explainOpenFailure, masterSecretFingerprint } = await import(
      '../../backend/src/backup/archive-key'
    );

    const current = masterSecretFingerprint('the-live-secret-of-this-server-32ch');
    const rotated = explainOpenFailure({
      sealedWith: masterSecretFingerprint('a-secret-from-before-the-rebuild-32c'),
      current,
      scope: 'both',
      hasPassphrase: false,
    });

    expect(rotated.code).toBe('SECRET_ROTATED');
    expect(rotated.restorable).toBe(false);
    // The message has to name the variable and the alternative, because the operator's
    // next action is not "try the password again".
    expect(rotated.message).toMatch(/BACKUP_ENCRYPTION_SECRET/);
    expect(rotated.message).toMatch(/archive-only/);
  });
});
