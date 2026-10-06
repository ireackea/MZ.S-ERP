import { describe, expect, it, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, backupRestorePin, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * FC-OPS-003 — a restore must not be the only copy of the data.
 *
 * ## Why this file exists separately from `ops-001-backup.spec.ts`
 *
 * `backup-dashboard.spec.ts:348` already asserted the right thing:
 *
 *     expect(String(previewPayload.data?.safetySnapshotId || '')).not.toBe('');
 *
 * It was correct, it was written by someone who understood the risk, and it has never
 * run — `run-suite.mjs:57` skips that spec because it drives a real browser. So the
 * single most dangerous property of the backup section was asserted only in a test
 * that nobody executes.
 *
 * A property guarded exclusively by an excluded test is not guarded. This file is
 * that property, reachable with nothing but HTTP, so it runs in the default gate.
 *
 * ## What it is actually testing
 *
 * `createRestorePreview` takes a snapshot of the current database before the operator
 * confirms, and returns its id in `safetySnapshotId`. The id is not a formality: it
 * is the handle an operator uses to undo the restore, and the thing that makes
 * "restore is reversible" true rather than asserted.
 *
 * The code sets `safetySnapshotId: null` unconditionally (`backup.service.ts:1582`),
 * and nothing else in the file ever fills it. So a restore runs `pg_restore --clean`
 * against the only copy of the data, and the interface — `BackupCenter.tsx:312` —
 * tells the operator «تم إنشاء لقطة أمان مؤقتة» while doing nothing.
 *
 * This test is written to fail against that. When it passes, the gap is closed and
 * the message in the interface became true.
 */

// Read the PIN the way the server reads it — the same helper the metrics token uses,
// so both come from one place and neither is hard-coded. Guessing a PIN, or pinning
// one literal, produces a test that fails for a reason unrelated to what it tests.
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

/** Everything this test creates, removed afterwards. */
const createdBackupIds = new Set<string>();

let cachedCookie = '';

const login = async () => {
  if (cachedCookie) return cachedCookie;
  const response = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status, 'login failed — is the backend up?').toBe(201);
  cachedCookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  return cachedCookie;
};

const api = async (path: string, init: RequestInit = {}) => {
  const cookie = await login();
  const response = await fetch(`${backendUrl}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers || {}) },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
};

const removeBackup = (id: string) =>
  spawnSync('curl', ['-s', '-X', 'DELETE', `${backendUrl}/api/backup/${id}`, '-H', `Cookie: ${cachedCookie}`], {
    encoding: 'utf8',
    timeout: 60_000,
  });

afterAll(() => {
  for (const id of createdBackupIds) removeBackup(id);
});

describeLive('FC-OPS-003 a restore is reversible', () => {
  it('takes a safety snapshot before a restore is confirmed, and names it', async () => {
    // A config backup is the cheapest thing to make and the one the dashboard flow
    // uses for this exact preview call, so the test does not have to touch data.
    const created = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `ops003-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(created.response.status, JSON.stringify(created.data)).toBe(200);
    const backupId = String(created.data?.data?.id || '');
    expect(backupId, 'the created backup must have an id').not.toBe('');
    createdBackupIds.add(backupId);

    // The preview is the operator's "yes, I mean to do this" step. It is the last
    // moment at which taking a copy is cheap — after `pg_restore --clean` begins, it
    // is far too late.
    const preview = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `ops003-${randomUUID()}` },
      body: JSON.stringify({ backupId, restorePin, confirmRestore: false }),
    });
    expect(preview.response.status, JSON.stringify(preview.data)).toBe(200);
    expect(preview.data?.stage).toBe('preview');
    expect(preview.data?.data?.restoreToken, 'the preview must issue a confirmation token').toBeTruthy();

    // The assertion this whole file exists for.
    //
    // Not "the preview is useful" and not "a token was issued" — the snapshot's
    // identity. Without it the operator has no handle on the pre-restore state, and
    // the only way back is another restore, which may fail the same way.
    expect(
      String(preview.data?.data?.safetySnapshotId || ''),
      'the preview must take a safety snapshot and return its id. Returning null means the ' +
        'restore runs against the only copy of the data, while the interface tells the ' +
        'operator a safety snapshot was taken.',
    ).not.toBe('');
  }, 120_000);

  it('refuses to confirm a restore whose preview never produced a snapshot', async () => {
    // The second half, and the part that actually protects the data: a confirmation
    // without a snapshot behind it must not be accepted, whatever the token says.
    //
    // This is the property the reset path already has — `SYSTEM_RESET_REFUSED_NO_BACKUP`
    // in `monitoring.service.ts`. The restore path has no equivalent, which is why the
    // two operations behave differently despite having the same blast radius.
    const created = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `ops003-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    const backupId = String(created.data?.data?.id || '');
    expect(backupId).not.toBe('');
    createdBackupIds.add(backupId);

    const preview = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `ops003-${randomUUID()}` },
      body: JSON.stringify({ backupId, restorePin, confirmRestore: false }),
    });
    const snapshotId = String(preview.data?.data?.safetySnapshotId || '');

    if (snapshotId) {
      createdBackupIds.add(snapshotId);
      // The snapshot exists, so there is nothing to assert about a refusal here — the
      // first test already covers the happy path. Said out loud rather than left as a
      // silent pass that could be mistaken for coverage.
      expect(snapshotId, 'a snapshot id was issued').not.toBe('');
      return;
    }

    const apply = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `ops003-${randomUUID()}` },
      body: JSON.stringify({
        backupId,
        restorePin,
        restoreToken: String(preview.data?.data?.restoreToken || ''),
        confirmRestore: true,
      }),
    });

    expect(
      apply.response.status,
      'a restore whose preview produced no safety snapshot must be refused. Accepting it is ' +
        'the defect: the operator gets a success message for a change that cannot be undone.',
    ).toBeGreaterThanOrEqual(400);
    expect(
      String(apply.data?.message || '').toLowerCase(),
      'the refusal must say why, in a word the operator can act on',
    ).toMatch(/snapshot|لقطة|backup|نسخ/);
  }, 120_000);
});
