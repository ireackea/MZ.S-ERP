import { describe, expect, it, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backendUrl, backupRestorePin, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * B21 — a downloaded backup can come back.
 *
 * ## The failure this is written against
 *
 * The operator's account: a backup is downloaded, then deleted from the list to free
 * space. The file is on the disk. There is no route that accepts it and no tool that
 * reads it, so that file is now the only copy of the database outside the system and
 * the system cannot use it. A restore — the operation that would need it — is
 * unreachable from the file.
 *
 * Asserting "the endpoint returns 201" would not have caught that, because the
 * endpoint did not exist and a 201 proves only that a file was accepted. What matters
 * is the whole round trip, and it is run here in the order an operator performs it:
 *
 *   create → download → delete → confirm it is gone → import the downloaded file →
 *   confirm it is back in the list → preview a restore from it
 *
 * The last step is what makes it a door rather than a shelf. An archive that reappears
 * in the list but cannot be restored is the same dead end wearing a different hat.
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

const listIds = async () => {
  const { data } = await api('/backup/list');
  return (Array.isArray(data?.data) ? data.data : []).map((row: any) => String(row?.id || ''));
};

const created: string[] = [];
const downloaded: string[] = [];

afterAll(() => {
  const cookie = cachedCookie;
  for (const id of [...created, ...downloaded]) {
    spawnSync('curl', ['-s', '-X', 'DELETE', `${backendUrl}/api/backup/${id}`, '-H', `Cookie: ${cookie}`], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  }
  rmSync(downloadDir, { recursive: true, force: true });
});

const downloadDir = mkdtempSync(join(tmpdir(), 'ffbkp-b21-'));

describeLive('B21 a deleted backup can be brought back from the file', () => {
  it('round-trips: create, download, delete, import, and restore-preview the imported copy', async () => {
    // 1. Something real to lose. A config archive is the cheapest thing to make and
    //    it is a genuine archive, not a stub.
    const made = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b21-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(made.response.status, JSON.stringify(made.data)).toBe(200);
    const backupId = String(made.data?.data?.id || '');
    expect(backupId).not.toBe('');
    created.push(backupId);
    // Whatever verdict the archive carried when it was created is the verdict it must
    // carry after coming back. Asserting the absolute value instead would bake in
    // whatever a `config` archive happens to be rated today, and a change to that
    // rating would then read as an import bug.
    const originalLabel = String(made.data?.data?.integrityLabel || '');

    // 2. Download it, to a real file on disk.
    const cookie = await login();
    const file = join(downloadDir, 'downloaded.ffbkp');
    const downloadedFile = spawnSync(
      'curl',
      ['-s', '-o', file, `${backendUrl}/api/backup/download/${backupId}`, '-H', `Cookie: ${cookie}`],
      { encoding: 'utf8', timeout: 120_000 },
    );
    expect(downloadedFile.status, 'the download command must succeed').toBe(0);
    expect(existsSync(file), 'the download must produce a file on disk').toBe(true);
    expect(statSync(file).size, 'the downloaded file must not be empty').toBeGreaterThan(0);

    // 3. Delete it from the list. This is the step that used to be a one-way street.
    const removed = await api(`/backup/${backupId}`, { method: 'DELETE' });
    expect(removed.response.status, JSON.stringify(removed.data)).toBe(200);
    expect(await listIds(), 'the archive must be gone from the list before the import').not.toContain(backupId);

    // 4. Import the file that is now the only copy outside the system.
    const form = new FormData();
    form.append('file', new Blob([require('node:fs').readFileSync(file)], { type: 'application/octet-stream' }), 'downloaded.ffbkp');
    const upload = await fetch(`${backendUrl}/api/backup/import`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    const uploadText = await upload.text();
    const uploaded = uploadText ? JSON.parse(uploadText) : null;
    downloaded.push(backupId);

    expect(upload.status, uploadText.slice(0, 300)).toBe(201);
    expect(String(uploaded?.data?.backup?.id || ''), 'the import must report the archive id').toBe(backupId);
    expect(
      uploaded?.data?.backup?.trigger,
      'an imported archive must not be filed as one the operator created here',
    ).toBe('import');
    expect(
      String(uploaded?.data?.backup?.integrityLabel || ''),
      'importing must not change the verdict: the same bytes, the same rating',
    ).toBe(originalLabel);
    // And it is not merely trusted — the service verified it on the way in, which is
    // the whole difference between an import and a copy.
    expect(
      uploaded?.data?.backup?.checksumSha256,
      'the row must carry a checksum computed from the imported file',
    ).toMatch(/^[0-9a-f]{64}$/);

    // 5. It is back in the list. Not in a drawer — in the list the restore reads.
    expect(await listIds()).toContain(backupId);

    // 6. And it is restorable. This is the step that distinguishes a door from a
    //    shelf: an archive that reappears but cannot be previewed is the same dead
    //    end, wearing a different hat.
    const preview = await api('/backup/restore', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b21-${randomUUID()}` },
      body: JSON.stringify({ backupId, restorePin, confirmRestore: false }),
    });
    expect(preview.response.status, JSON.stringify(preview.data)).toBe(200);
    expect(preview.data?.stage).toBe('preview');
    expect(preview.data?.data?.restoreToken, 'the re-imported archive must be previewable').toBeTruthy();
    // B1 again, on the imported copy: the preview takes a safety snapshot of its own.
    expect(String(preview.data?.data?.safetySnapshotId || '')).not.toBe('');
    downloaded.push(String(preview.data?.data?.safetySnapshotId || ''));

    // The token is consumed by nothing above, so drop it explicitly rather than
    // leaving a live undo nobody will use.
    const snapshotId = String(preview.data?.data?.safetySnapshotId || '');
    if (snapshotId) created.push(snapshotId);
  }, 240_000);

  it('refuses a file that is not a backup, and says why', async () => {
    const cookie = await login();
    const bogus = join(downloadDir, 'not-a-backup.ffbkp');
    require('node:fs').writeFileSync(bogus, 'shopping list, not an archive', 'utf8');

    const form = new FormData();
    form.append('file', new Blob([require('node:fs').readFileSync(bogus)], { type: 'application/octet-stream' }), 'not-a-backup.ffbkp');
    const response = await fetch(`${backendUrl}/api/backup/import`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = JSON.parse(text); } catch { payload = null; }

    // A 400 with a reason, not a 500 and not a silent 201 that adds a row the
    // operator did not import.
    expect(response.status).toBe(400);
    expect(String(payload?.message || '')).not.toBe('');
  }, 120_000);
});
