/**
 * FC-ITEM-001 — attachment filename and storage integrity.
 *
 * Rules enforced here:
 *  - The generated filename is the ONLY identity returned and persisted. The
 *    client's original name is treated as untrusted display text, never as a path.
 *  - Extension and MIME must agree, so renaming `evil.php` to `evil.png` fails.
 *  - Stored paths are relative to the configured upload root, and traversal is
 *    rejected structurally rather than by string-stripping.
 */
import { randomBytes } from 'node:crypto';
import { basename, extname, posix } from 'node:path';

export const UPLOAD_ROOT = './uploads/items';

export type AttachmentKind = 'image' | 'file';

export type AllowedMime = {
  mime: string;
  extensions: string[];
};

const IMAGE_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/avif': ['.avif'],
};

const DOCUMENT_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/json': ['.json'],
};

export const LIMITS = {
  image: { bytes: 5 * 1024 * 1024, label: 'image' },
  file: { bytes: 10 * 1024 * 1024, label: 'file' },
} as const;

/** Control characters and RTL overrides can visually disguise a filename. */
const UNSAFE_DISPLAY_CHARS = /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Produces the display-safe original name. Never used to build a path.
 * Path separators and dot-segments are dropped so a stored label cannot be
 * replayed as a location later.
 */
export const sanitizeDisplayName = (originalName: string): string => {
  const raw = String(originalName || '').replace(UNSAFE_DISPLAY_CHARS, '').trim();
  const flat = basename(raw.replace(/\\/g, '/'))
    .replace(/^\.+/, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.slice(0, 120) || 'attachment';
};

const extensionOf = (name: string): string => extname(String(name || '')).toLowerCase();

/**
 * Finds the canonical extension for a declared MIME type, and verifies the
 * uploaded name's extension agrees with it.
 */
export const resolveExtension = (
  originalName: string,
  mimetype: string,
  kind: AttachmentKind,
): { extension: string } | { error: string } => {
  const mime = String(mimetype || '').split(';')[0].trim().toLowerCase();
  const table = kind === 'image' ? IMAGE_MIME : { ...IMAGE_MIME, ...DOCUMENT_MIME };

  const allowedExtensions = table[mime];
  if (!allowedExtensions) {
    return { error: `Unsupported ${kind} type: ${mime || 'unknown'}` };
  }

  const declared = extensionOf(originalName);
  if (declared && !allowedExtensions.includes(declared)) {
    return {
      error: `Extension "${declared}" does not match the declared type "${mime}". Allowed: ${allowedExtensions.join(', ')}`,
    };
  }

  return { extension: allowedExtensions[0] };
};

/** Magic-number check so a renamed executable cannot masquerade as an image. */
export const sniffImageSignature = (buffer: Buffer | null | undefined): string | null => {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'image/avif';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 2).toString('ascii') === 'PK') return 'application/zip';

  return null;
};

export const isImageMime = (mimetype: string): boolean =>
  IMAGE_MIME[String(mimetype || '').split(';')[0].trim().toLowerCase()] !== undefined;

/** Mime types accepted for the generic "file" attachment slot. */
export const isAllowedDocumentMime = (mimetype: string): boolean => {
  const mime = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (DOCUMENT_MIME[mime]) return true;
  // OOXML documents are frequently reported as a plain zip by some clients.
  if (mime === 'application/zip') return true;
  return false;
};

export type SafeFileName = {
  /** Generated name on disk AND in the DB. The single source of identity. */
  storedName: string;
  /** Sanitized original name, for display only. */
  displayName: string;
  extension: string;
  mimeType: string;
  size: number;
  /** Relative public path, e.g. `uploads/items/<storedName>`. */
  relativePath: string;
  sizeLimit: number;
};

export type SafeNameResult =
  | { ok: true; value: SafeFileName }
  | { ok: false; error: string };

/**
 * FC-ITEM-001 — verifies the bytes actually match the declared image type.
 *
 * The declared `Content-Type` is attacker-controlled, so a filter that trusts it
 * accepts a Windows executable renamed to `.png` and typed `image/png`. The
 * signature check is the only thing that actually establishes the content.
 * Call this once the upload has been written and the bytes are readable.
 */
export const assertRealImageContent = (
  storedName: string,
  readBytes: (path: string) => Promise<Buffer>,
  root: string = UPLOAD_ROOT,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const target = resolveStoredPath(root, basename(storedName));
  if (!target) return Promise.resolve({ ok: false, error: 'Invalid stored path' });

  return readBytes(target)
    .then((buffer) => {
      const sniffed = sniffImageSignature(buffer);
      if (!sniffed || !isImageMime(sniffed)) {
        return {
          ok: false as const,
          error: 'File content is not a recognised image. The declared type is not trusted.',
        };
      }
      return { ok: true as const };
    })
    .catch(() => ({ ok: false as const, error: 'Uploaded file could not be read back' }));
};

/**
 * Builds the attachment identity. The `publicId` is sanitised too, because it
 * reaches us from the URL.
 */
export const buildAttachmentName = (params: {
  publicId: string;
  originalName: string;
  mimetype: string;
  size: number;
  kind: AttachmentKind;
  randomSuffix?: string;
}): SafeNameResult => {
  const { publicId, originalName, mimetype, size, kind } = params;
  const limit = LIMITS[kind].bytes;

  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Uploaded file is empty' };
  }
  if (size > limit) {
    return {
      ok: false,
      error: `File exceeds the ${LIMITS[kind].label} limit of ${Math.floor(limit / (1024 * 1024))}MB`,
    };
  }

  const resolved = resolveExtension(originalName, mimetype, kind);
  if ('error' in resolved) return { ok: false, error: resolved.error };

  // publicId is attacker-influenced: keep only a safe slug.
  const safePublicId = String(publicId || '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 48) || 'item';

  const suffix = params.randomSuffix ?? randomBytes(8).toString('hex');
  const storedName = `${safePublicId}-${suffix}${resolved.extension}`;

  // Belt and braces: the generated name must not contain a separator.
  if (storedName.includes('/') || storedName.includes('\\') || storedName.includes('..')) {
    return { ok: false, error: 'Generated filename is not safe' };
  }

  return {
    ok: true,
    value: {
      storedName,
      displayName: sanitizeDisplayName(originalName),
      extension: resolved.extension,
      mimeType: String(mimetype || '').split(';')[0].trim().toLowerCase(),
      size,
      relativePath: posix.join('uploads/items', storedName),
      sizeLimit: limit,
    },
  };
};

export const resolveStoredPath = (root: string, relativePath: string): string | null => {
  const normalizedRoot = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const raw = String(relativePath || '').replace(/\\/g, '/');

  if (!raw || raw.includes('\0')) return null;

  // An absolute path or a Windows drive letter is refused outright rather than
  // re-rooted, so a caller can never silently receive a different file than it
  // asked for.
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;

  const candidate = raw.replace(/^\/+/, '');
  const segments = candidate.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) return null;

  const resolved = posix.normalize(posix.join(normalizedRoot, ...segments));
  const rootWithSlash = `${posix.normalize(normalizedRoot)}/`;

  if (resolved !== posix.normalize(normalizedRoot) && !resolved.startsWith(rootWithSlash)) {
    return null;
  }

  return resolved;
};
