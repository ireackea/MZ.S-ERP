import { describe, expect, it } from 'vitest';
import { posix } from 'node:path';
import {
  LIMITS,
  UPLOAD_ROOT,
  assertRealImageContent,
  buildAttachmentName,
  isAllowedDocumentMime,
  isImageMime,
  resolveExtension,
  resolveStoredPath,
  sanitizeDisplayName,
  sniffImageSignature,
} from './attachment-safety';

const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR'),
]);

describe('FC-ITEM-001 attachment safety', () => {
  it('accepts a valid image upload and returns one generated identity', () => {
    const result = buildAttachmentName({
      publicId: 'ITEM-42',
      originalName: 'photo.PNG',
      mimetype: 'image/png',
      size: 2048,
      kind: 'image',
      randomSuffix: 'fixed123',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The generated name is deterministic given the suffix, and is the identity.
    expect(result.value.storedName).toBe('ITEM-42-fixed123.png');
    expect(result.value.relativePath).toBe('uploads/items/ITEM-42-fixed123.png');
    expect(result.value.displayName).toBe('photo.PNG');
    expect(result.value.mimeType).toBe('image/png');
    // The display name and the stored name are deliberately different concerns.
    expect(result.value.displayName).not.toBe(result.value.storedName);
  });

  it('rejects an extension that disagrees with the declared type', () => {
    const result = buildAttachmentName({
      publicId: 'ITEM-1',
      originalName: 'payload.php',
      mimetype: 'image/png',
      size: 100,
      kind: 'image',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/does not match/i);
  });

  it('rejects a type that is not on the allow-list', () => {
    for (const mime of ['application/x-msdownload', 'text/html', 'image/svg+xml', 'application/x-sh']) {
      const result = buildAttachmentName({
        publicId: 'ITEM-1',
        originalName: 'file.bin',
        mimetype: mime,
        size: 100,
        kind: 'image',
      });
      expect(result.ok, `${mime} must be rejected for images`).toBe(false);
    }
  });

  it('rejects an empty or oversized file', () => {
    expect(buildAttachmentName({ publicId: 'I', originalName: 'a.png', mimetype: 'image/png', size: 0, kind: 'image' }).ok).toBe(false);
    expect(
      buildAttachmentName({
        publicId: 'I',
        originalName: 'a.png',
        mimetype: 'image/png',
        size: LIMITS.image.bytes + 1,
        kind: 'image',
      }).ok,
    ).toBe(false);
    expect(
      buildAttachmentName({
        publicId: 'I',
        originalName: 'a.pdf',
        mimetype: 'application/pdf',
        size: LIMITS.file.bytes + 1,
        kind: 'file',
      }).ok,
    ).toBe(false);
  });

  it('never lets the original name or publicId become a path', () => {
    const result = buildAttachmentName({
      publicId: '../../etc',
      originalName: '../../../root/.ssh/authorized_keys',
      mimetype: 'image/png',
      size: 100,
      kind: 'image',
      randomSuffix: 'abc',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storedName).not.toContain('..');
    expect(result.value.storedName).not.toContain('/');
    expect(result.value.storedName).not.toContain('\\');
    expect(result.value.relativePath).toBe('uploads/items/etc-abc.png');
    // The traversal survives only as flattened display text.
    expect(result.value.displayName).not.toContain('/');
    expect(result.value.displayName).not.toContain('..');
  });

  it('sanitises display names against control and bidi-spoofing characters', () => {
    expect(sanitizeDisplayName('a\u0000b.txt')).toBe('ab.txt');
    expect(sanitizeDisplayName('invoice\u202Eexe.pdf')).toBe('invoiceexe.pdf');
    expect(sanitizeDisplayName('C:\\temp\\file.png')).toBe('file.png');
    expect(sanitizeDisplayName('   ')).toBe('attachment');
    expect(sanitizeDisplayName('...')).toBe('attachment');
    expect(sanitizeDisplayName('x'.repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it('resolves extensions from the MIME type, not the filename', () => {
    expect(resolveExtension('x.jpg', 'image/jpeg', 'image')).toEqual({ extension: '.jpg' });
    expect(resolveExtension('x', 'image/png', 'image')).toEqual({ extension: '.png' });
    // A missing extension is repaired from the MIME type.
    expect(resolveExtension('photo', 'image/webp', 'image')).toEqual({ extension: '.webp' });
    expect('error' in resolveExtension('x.svg', 'image/svg+xml', 'image')).toBe(true);
  });

  it('detects the real type from file signatures', () => {
    expect(sniffImageSignature(PNG_HEADER)).toBe('image/png');
    expect(sniffImageSignature(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageSignature(Buffer.from('%PDF-1.7 rest'))).toBe('application/pdf');
    expect(sniffImageSignature(Buffer.from('MZ\x90\x00this is a pe file'))).toBeNull();
    expect(sniffImageSignature(null)).toBeNull();
    expect(sniffImageSignature(Buffer.from('ab'))).toBeNull();
  });

  it('refuses a real non-image whose Content-Type claims image/png', async () => {
    // The declared type is attacker-controlled, so the bytes are what matter.
    const pe = Buffer.concat([
      Buffer.from('MZ', 'ascii'),
      Buffer.from([0x90, 0x00, 0x03]),
      Buffer.alloc(64, 0x00),
    ]);

    const result = await assertRealImageContent('ITEM-1-evil.png', async () => pe, './uploads/items');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a recognised image/i);
  });

  it('accepts genuine image bytes', async () => {
    const result = await assertRealImageContent('ITEM-1-real.png', async () => PNG_HEADER, './uploads/items');
    expect(result.ok).toBe(true);
  });

  it('neutralises a traversal attempt instead of escaping the root', async () => {
    // basename() flattens the attempt to `passwd`, which stays inside the root.
    // The check therefore succeeds, but only ever over the flattened name.
    const seen: string[] = [];
    const result = await assertRealImageContent('../../etc/passwd', async (path) => {
      seen.push(path);
      return PNG_HEADER;
    }, './uploads/items');

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('..');
    expect(seen[0]).toBe('uploads/items/passwd');
    expect(result.ok).toBe(true);
  });

  it('reports an unreadable file instead of throwing', async () => {
    const result = await assertRealImageContent('ITEM-1-missing.png', async () => {
      throw new Error('ENOENT');
    }, './uploads/items');
    expect(result.ok).toBe(false);
  });

  it('classifies mime types for the two upload slots', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/png; charset=binary')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);

    expect(isAllowedDocumentMime('application/pdf')).toBe(true);
    expect(isAllowedDocumentMime('application/zip')).toBe(true);
    expect(isAllowedDocumentMime('text/html')).toBe(false);
    expect(isAllowedDocumentMime('application/x-msdownload')).toBe(false);
  });

  it('refuses any stored path that escapes the upload root', () => {
    const root = UPLOAD_ROOT;
    // resolveStoredPath is deliberately POSIX-based: it compares normalised
    // relative paths, independent of the host separator.
    const expected = (relative: string) => posix.join(root.replace(/\\/g, '/'), relative);

    expect(resolveStoredPath(root, 'ITEM-1-abc.png')).toBe(expected('ITEM-1-abc.png'));
    expect(resolveStoredPath(root, '../secrets.env')).toBeNull();
    expect(resolveStoredPath(root, '../../etc/passwd')).toBeNull();
    expect(resolveStoredPath(root, 'a/../../b.png')).toBeNull();
    expect(resolveStoredPath(root, '..\\..\\windows\\system32')).toBeNull();
    expect(resolveStoredPath(root, '/absolute/path.png')).toBeNull();
    expect(resolveStoredPath(root, '')).toBeNull();
    expect(resolveStoredPath(root, 'nul\0byte.png')).toBeNull();

    // A prefix-confusion sibling must not pass either.
    expect(resolveStoredPath('./uploads/items', '../items-secret/x.png')).toBeNull();
  });

  it('normalises benign path shapes rather than rejecting them', () => {
    const expected = (relative: string) => posix.join('uploads/items', relative);
    expect(resolveStoredPath('./uploads/items', './ITEM-1.png')).toBe(expected('ITEM-1.png'));
    expect(resolveStoredPath('./uploads/items/', 'ITEM-1.png')).toBe(expected('ITEM-1.png'));
    expect(resolveStoredPath('./uploads/items', 'sub/ITEM-1.png')).toBe(expected('sub/ITEM-1.png'));
  });
});
