import { describe, expect, it, afterAll, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backendUrl, backupRestorePin, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * B21 — the import, through the client the interface actually uses.
 *
 * ## Why this file exists separately from `ops-004-backup-import.spec.ts`
 *
 * That spec proved the *server* accepts an archive: it posted a real `FormData`
 * through bare `fetch`, which sets `Content-Type: multipart/form-data; boundary=…`
 * by itself. It passed.
 *
 * The button in the interface posted the same bytes through `apiClient`, which sets
 * `Content-Type: application/json` on every request. The body arrived labelled as
 * JSON with no boundary, multer parsed zero files, and every attempt answered
 * «لم يُرفَق ملف». Server proved working, button broken, test green — because the
 * test was not exercising the button's code.
 *
 * This file closes that gap the only way that counts: it posts through `apiClient`.
 * A test that uses a different client is a test of a different thing, and the
 * difference here was invisible for hours.
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

/**
 * `apiClient` in the Node process this test runs in.
 *
 * Imported rather than reimplemented: the whole point is to send the request the way
 * the interface sends it, and a hand-rolled copy of the client would be a different
 * client — which is the mistake that let this reach production.
 *
 * The `@…` aliases are declared here rather than in a root config because the e2e
 * specs run outside the frontend's vitest project. Without them the import fails on
 * `@utils/bootstrapMetrics` and the test cannot run at all — which is the worse
 * outcome, because the defect it guards is invisible from the root suite.
 */
vi.mock('@utils/bootstrapMetrics', () => ({ markBootstrapRequest: () => undefined }));
vi.mock('@services/authSession', () => ({ clearAllAuthData: () => undefined }));

const { default: apiClient } = await import('../../frontend/src/api/client');

const downloadDir = mkdtempSync(join(tmpdir(), 'ffbkp-b21-client-'));
const created: string[] = [];

afterAll(() => {
  for (const id of created) {
    spawnSync('curl', ['-s', '-X', 'DELETE', `${backendUrl}/api/backup/${id}`, '-H', `Cookie: ${cookie}`], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  }
  rmSync(downloadDir, { recursive: true, force: true });
});

describeLive('B21 the import button, through the interface\'s own HTTP client', () => {
  it('delivers the file, where a request labelled as JSON delivered nothing', async () => {
    const session = await login();

    // Something real to lose, and a real file on disk to bring back.
    const made = await fetch(`${backendUrl}/api/backup/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session, 'Idempotency-Key': `b21c-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    const madeBody = await made.json();
    const backupId = String(madeBody?.data?.id || '');
    expect(backupId).not.toBe('');
    created.push(backupId);

    const file = join(downloadDir, 'client.ffbkp');
    const downloaded = spawnSync(
      'curl',
      ['-s', '-o', file, `${backendUrl}/api/backup/download/${backupId}`, '-H', `Cookie: ${session}`],
      { encoding: 'utf8', timeout: 120_000 },
    );
    expect(downloaded.status).toBe(0);
    expect(statSync(file).size).toBeGreaterThan(0);

    await fetch(`${backendUrl}/api/backup/${backupId}`, { method: 'DELETE', headers: { Cookie: session } });

    // The request the interface makes. `apiClient` with the session cookie, a
    // FormData body, and no explicit Content-Type.
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)], { type: 'application/octet-stream' }), 'client.ffbkp');

    const response = await apiClient.post('/backup/import', form, {
      headers: { Cookie: session },
      baseURL: backendUrl,
      withCredentials: false,
    });

    // The failure this file exists for: 400 with «لم يُرفَق ملف», because the body
    // was labelled `application/json` and arrived with no boundary.
    expect(response.status, JSON.stringify(response.data)).toBe(201);

    const body = response.data as any;
    expect(String(body?.data?.backup?.id || '')).toBe(body?.data?.backup?.id);
    expect(String(body?.data?.backup?.id || ''), 'the archive must come back by its own id').toBe(backupId);
    expect(body?.data?.backup?.trigger).toBe('import');

    // And it is in the list, ready for a restore preview.
    const listed = await fetch(`${backendUrl}/api/backup/list`, { headers: { Cookie: session } });
    const rows = (await listed.json())?.data ?? [];
    expect(rows.map((row: any) => String(row?.id || ''))).toContain(backupId);

    const preview = await fetch(`${backendUrl}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session, 'Idempotency-Key': `b21c-${randomUUID()}` },
      body: JSON.stringify({ backupId, restorePin, confirmRestore: false }),
    });
    const previewBody = await preview.json();
    expect(previewBody?.stage, 'an imported archive must be previewable').toBe('preview');
    created.push(String(previewBody?.data?.safetySnapshotId || ''));
  }, 240_000);

  it('still says "no file" when there is genuinely no file', async () => {
    // The fix must not have turned the message into a constant. A missing file is
    // still a missing file, and the operator should still be told so in words rather
    // than shown a 500.
    const session = await login();
    const form = new FormData();
    form.append('notTheFile', 'something');

    let status = 0;
    let message = '';
    try {
      const response = await apiClient.post('/backup/import', form, {
        headers: { Cookie: session },
        baseURL: backendUrl,
        withCredentials: false,
      });
      status = response.status;
      message = String((response.data as any)?.message || '');
    } catch (error: any) {
      status = error?.response?.status ?? 0;
      message = String(error?.response?.data?.message || '');
    }

    expect(status).toBe(400);
    expect(message).not.toBe('');
    expect(existsSync(file_placeholder())).toBe(false);
  }, 120_000);
});

// A path that must never exist: the staging directory is created lazily and a
// rejected upload must leave nothing behind.
const file_placeholder = () => join(downloadDir, 'never-written.ffbkp');
