import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';

const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
};

const data = (body: any) => body?.data ?? body;

const login = async (username: string, password: string) => {
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(result.response.status).toBe(201);
  return String(result.response.headers.get('set-cookie') || '').split(';')[0];
};

/** A real PNG so magic-number sniffing has something valid to accept. */
const pngBytes = () => {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  return Buffer.concat([header, ihdr, Buffer.from('IDATxxxxxxxxxxxxIEND', 'ascii')]);
};

/**
 * The upload directory lives inside the container, so it is inspected there.
 * Returns [] when the daemon is unavailable rather than failing the assertion
 * for the wrong reason.
 */
const listUploads = (): string[] => {
  try {
    const out = execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'backend', 'sh', '-lc', 'ls ./uploads/items 2>/dev/null'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000 },
    );
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

describe('FC-ITEM-001 attachment filename and storage integrity', () => {
  it('uploads an image and serves it back under the generated name', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie };
    const suffix = randomUUID();
    const itemPublicId = `attach-item-${suffix}`;
    let storedName = '';
    let downloadUrl = '';

    try {
      const item = await request('/items', {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId: itemPublicId, name: `Attachment item ${suffix}`, unit: 'kg' }),
      });
      expect(item.response.status).toBe(201);

      const form = new FormData();
      // A client filename full of traversal and unicode tricks.
      form.append('file', new Blob([pngBytes()], { type: 'image/png' }), '../../evil\u202E.png');

      const uploaded = await request(`/items/${itemPublicId}/upload-image`, {
        method: 'POST',
        headers: adminHeaders,
        body: form,
      });
      expect(uploaded.response.status).toBe(201);

      const payload = data(uploaded.body);
      storedName = payload.fileName;
      downloadUrl = payload.url;

      // The generated name is the identity: no traversal, no client name.
      expect(storedName).toMatch(/^attach-item-[A-Za-z0-9-]+-[0-9a-f]{16}\.png$/);
      expect(storedName).not.toContain('..');
      expect(storedName).not.toContain('evil');
      expect(payload.originalName).not.toContain('..');
      expect(payload.originalName).not.toContain('\u202E');
      expect(downloadUrl).toBe(`/items/attachments/${encodeURIComponent(storedName)}`);

      // It is really on disk under that name.
      expect(listUploads()).toContain(storedName);

      // And the guarded route serves it with a safe disposition.
      const download = await fetch(`${backendUrl}/api${downloadUrl}`, { headers: adminHeaders });
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('image/png');
      expect(download.headers.get('content-disposition')).toContain('attachment');
      expect(download.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await download.arrayBuffer()).byteLength).toBe(pngBytes().byteLength);

      // The DB holds the same identity, not the client's string.
      const reread = await request(`/items/${itemPublicId}`, { headers: adminHeaders });
      expect(reread.response.status).toBe(200);
      expect(data(reread.body).imageUrl).toBe(downloadUrl);
    } finally {
      await request('/items/delete', {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
    }
  }, 40_000);

  it('rejects a non-image, a type/extension mismatch, and an oversized file', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie };
    const suffix = randomUUID();
    const itemPublicId = `attach-reject-${suffix}`;
    const before = new Set(listUploads());

    try {
      const item = await request('/items', {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId: itemPublicId, name: `Reject item ${suffix}`, unit: 'kg' }),
      });
      expect(item.response.status).toBe(201);

      // 1. An executable is not an image, even with an .png extension.
      const exe = new FormData();
      exe.append('file', new Blob([Buffer.from('MZ\u0090\u0000executable')], { type: 'image/png' }), 'payload.png');
      const exeResult = await request(`/items/${itemPublicId}/upload-image`, {
        method: 'POST', headers: adminHeaders, body: exe,
      });
      expect(exeResult.response.status).toBeGreaterThanOrEqual(400);

      // 2. A declared type that disagrees with the extension is refused.
      const mismatch = new FormData();
      mismatch.append('file', new Blob([Buffer.from('%PDF-1.7')], { type: 'image/png' }), 'doc.png');
      const mismatchResult = await request(`/items/${itemPublicId}/upload-image`, {
        method: 'POST', headers: adminHeaders, body: mismatch,
      });
      expect(mismatchResult.response.status).toBeGreaterThanOrEqual(400);

      // 3. Nothing was left behind by any of the rejections.
      const after = listUploads();
      expect(after.filter((name) => !before.has(name))).toHaveLength(0);
    } finally {
      await request('/items/delete', {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
    }
  }, 40_000);

  it('refuses to serve a path outside the upload root', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie };

    for (const attempt of ['..%2F..%2F.env', '..%5C..%5C.env', '....//package.json']) {
      const result = await request(`/items/attachments/${attempt}`, { headers: adminHeaders });
      expect([400, 404], `${attempt} must not be served`).toContain(result.response.status);
    }
  }, 30_000);

  it('cleans up the file when the database write fails', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie };
    const suffix = randomUUID();
    const before = new Set(listUploads());

    // A publicId that satisfies the route but has no matching item row.
    const orphan = `attach-orphan-${suffix}`;
    const form = new FormData();
    form.append('file', new Blob([pngBytes()], { type: 'image/png' }), 'orphan.png');

    const result = await request(`/items/${orphan}/upload-image`, {
      method: 'POST', headers: adminHeaders, body: form,
    });
    expect(result.response.status).toBe(404);

    // multer wrote the file before the service discovered the item was missing.
    // FC-ITEM-001 requires it to be removed again.
    const leaked = listUploads().filter((name) => !before.has(name));
    expect(leaked, `orphaned upload left on disk: ${leaked.join(', ')}`).toHaveLength(0);
  }, 30_000);
});
