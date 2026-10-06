import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * Phase 0 — the defect that made every backup on the server unrestorable.
 *
 * ## What was wrong
 *
 * `verifyRestorePinOrThrow` refused when the caller sent no PIN, and then refused again
 * when no PIN was configured. Together: **a restore is impossible unless a PIN has been
 * configured** — and a default deployment has none. The interface demanded a code that
 * did not exist and could not be obtained, so there was nothing to type.
 *
 * The safety snapshot, the `backup.restore` permission, the admin role, the destructive
 * rate limit and the two-step confirmation were all present and all unreachable.
 *
 * ## What is asserted here
 *
 * The whole flow against a running server: take an archive, preview the restore **with no
 * PIN**, and receive a token and a safety snapshot. If any layer still demands a PIN, this
 * fails — which is the point, because the unit tests cannot see a guard in a component.
 *
 * Nothing destructive is applied. The preview is the last safe step, and asserting on it
 * is what makes the assertion safe to run in a suite.
 */

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

describeLive('Phase 0 — a restore with no PIN configured', () => {
  it('the server reports that no PIN is configured, so the screen can stop asking', async () => {
    const stats = await api('/backup/storage-stats');
    expect(stats.response.status, JSON.stringify(stats.data)).toBe(200);

    const hasRestorePin = stats.data?.data?.schedule?.hasRestorePin;
    // The field has existed since B5 and was declared in the API types, but nothing ever
    // read it. This assertion is what makes dropping it again visible.
    expect(
      typeof hasRestorePin,
      'hasRestorePin must be present, or the interface has to guess whether to demand a code',
    ).toBe('boolean');
  }, 120_000);

  it('previews a restore with an empty PIN instead of refusing', async () => {
    const stats = await api('/backup/storage-stats');
    const requiresPin = stats.data?.data?.schedule?.hasRestorePin === true;

    const made = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p0-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(made.response.status, JSON.stringify(made.data)).toBe(200);
    const backupId = String(made.data?.data?.id || '');
    expect(backupId).not.toBe('');
    created.push(backupId);

    // The call the interface used to refuse to even make.
    const preview = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p0b-${randomUUID()}` },
      body: JSON.stringify({ backupId, confirmRestore: false }),
    });

    if (requiresPin) {
      // A PIN really is configured on this deployment, so demanding it is correct.
      expect(preview.response.status).toBe(401);
      expect(String(preview.data?.message || '')).toMatch(/PIN/i);
      return;
    }

    // The defect: this answered 401 «Restore PIN is required», and there was no code to
    // type. Restoring any archive on this server was impossible.
    expect(preview.response.status, JSON.stringify(preview.data)).toBe(200);
    expect(preview.data?.data?.restoreToken).toBeTruthy();
    // The undo must exist, or the confirmation screen is a lie one step later.
    expect(preview.data?.data?.safetySnapshotId).toBeTruthy();
    created.push(String(preview.data?.data?.safetySnapshotId || ''));

    // And the preview now says what is actually protecting the restore, instead of a
    // fixed sentence claiming a PIN whether or not one is running.
    const protection = preview.data?.data?.restoreProtection;
    expect(protection, 'the preview must report its real protection state').toBeTruthy();
    expect(protection.requiresPin).toBe(false);
    expect(protection.takesSafetySnapshot).toBe(true);
  }, 300_000);

  it('still refuses when a PIN is configured but the wrong one is sent', async () => {
    // The permissive branch must not have become "accepts anything". If this deployment
    // has no PIN configured, the assertion is vacuous and says so rather than pretending.
    const stats = await api('/backup/storage-stats');
    if (stats.data?.data?.schedule?.hasRestorePin !== true) {
      expect(true, 'no PIN configured here, so this path is covered by the unit tests').toBe(true);
      return;
    }

    const list = await api('/backup/list');
    const any = (list.data?.data || [])[0];
    expect(any).toBeTruthy();

    const preview = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p0c-${randomUUID()}` },
      body: JSON.stringify({ backupId: any.id, restorePin: 'definitely-wrong', confirmRestore: false }),
    });
    expect([401, 429]).toContain(preview.response.status);
  }, 300_000);
});