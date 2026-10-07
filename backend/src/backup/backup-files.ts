/**
 * B18/S1 — the disk and cryptography primitives, out of the 3,852-line service.
 *
 * ## Why these moved and why they did not move away
 *
 * `backup.service.ts` had grown past the point where a change to the restore path could
 * be reviewed, because the restore path shared a file with the schedule, the manifest
 * writer, the PIN store and the import path. The functions here are the ones that had
 * no business being in that file at all: each one is a pure function of its arguments
 * plus the filesystem, with no service state, no database and no clock.
 *
 * They are still *called* through thin private wrappers on the service, and that is not
 * an oversight. `ops-004-backup-honesty` asserts that `writeArchiveAtomically` exists on
 * the service with that signature and is reached as `this.writeArchiveAtomically(...)`,
 * because the property it encodes — the archive is renamed into place and a short write
 * is removed — is a property of the *call site* as much as of the function. Moving the
 * body and deleting the wrapper would have deleted the assertion's subject.
 *
 * ## What this file deliberately does not own
 *
 * Key derivation lives in `./archive-key`, retention in `./retention`, reconciliation in
 * `./backup-reconcile`, disk headroom in `./disk-headroom`, off-host copies in
 * `./offsite-copy`. A second copy of any of those is the failure this repository has
 * already paid for twice, so there is none here.
 */

import { createHash, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

/**
 * The only files an archive is allowed to carry.
 *
 * An allow-list and not a directory walk: the alternative lets a backup capture
 * whatever happens to be in the working directory, which on one deployment is a `.env`.
 *
 * The separators are forward slashes on every platform, and that is the whole point of
 * spelling it out. Built with `path.join`, the second entry was `server\server-data.json`
 * on Windows and `server/server-data.json` on Linux — so an archive taken on one was
 * silently skipped on the other, the restore wrote fewer files than it reported, and
 * nothing said so. `path.resolve` accepts a forward slash on Windows, so nothing needs
 * platform-specific handling below.
 */
export const CONFIG_FILES_ALLOW_LIST = ['metadata.json', 'server/server-data.json'];

/**
 * Archives written before the list was platform-independent carry `server\...`.
 *
 * They are still restorable: the check normalises the incoming path instead of
 * comparing it literally, so tightening the list's spelling did not turn every archive
 * taken on Windows into an incomplete restore.
 */
const normalizeRelativePath = (value: string): string => String(value || '').replace(/\\/g, '/');

export const isAllowedConfigPath = (relativePath: string): boolean =>
  CONFIG_FILES_ALLOW_LIST.includes(normalizeRelativePath(relativePath));

export const hashSha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

/**
 * Seals a small secret with the master secret.
 *
 * The key is the SHA-256 of `masterSecret` rather than the secret itself, which is what
 * the historical form did; keeping that byte-identical is why archives written before
 * B11 still open.
 */
export const encryptSecret = (secret: string, masterSecret: string): string => {
  const iv = randomBytes(12);
  const key = createHash('sha256').update(masterSecret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
};

export const decryptSecret = (payload: string | undefined, masterSecret: string): string => {
  if (!payload) return '';
  const [ivRaw, tagRaw, dataRaw] = payload.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) return '';

  const key = createHash('sha256').update(masterSecret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]).toString('utf8');
};

/** 180,000 rounds. The PIN store is the only user, and it is an operator-set secret. */
export const hashSecret = (secret: string): { hash: string; saltBase64: string } => {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(secret, salt, 180000, 32, 'sha256').toString('hex');
  return { hash, saltBase64: salt.toString('base64') };
};

export const verifySecret = (secret: string, hashHex?: string, saltBase64?: string): boolean => {
  if (!hashHex || !saltBase64) return false;
  const computed = pbkdf2Sync(secret, Buffer.from(saltBase64, 'base64'), 180000, 32, 'sha256').toString('hex');
  const left = Buffer.from(hashHex, 'hex');
  const right = Buffer.from(computed, 'hex');
  // Compared in constant time and only when the lengths agree: `timingSafeEqual`
  // throws on a mismatch, and a thrown error here would answer "wrong PIN" with a 500.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export type ConfigSnapshot = { relativePath: string; contentBase64: string };

export const collectConfigFiles = async (root: string = process.cwd()): Promise<ConfigSnapshot[]> => {
  const files: ConfigSnapshot[] = [];
  for (const relativePath of CONFIG_FILES_ALLOW_LIST) {
    const fullPath = path.resolve(root, relativePath);
    if (!fs.existsSync(fullPath)) continue;
    const stat = await fsPromises.stat(fullPath).catch(() => null);
    if (!stat?.isFile()) continue;
    const content = await fsPromises.readFile(fullPath, 'utf8').catch(() => '');
    // Stored normalised, so the archive says the same thing on every machine.
    files.push({ relativePath, contentBase64: Buffer.from(content, 'utf8').toString('base64') });
  }
  return files;
};

/**
 * Writes an archive's config files back.
 *
 * The allow-list is re-checked here and not trusted from the payload. The payload came
 * from a file the operator uploaded, so a path in it is an instruction, and an
 * instruction that names `.env` is the one this guard exists to refuse.
 */
export const restoreConfigFiles = async (files: ConfigSnapshot[], root: string = process.cwd()): Promise<number> => {
  let count = 0;
  for (const file of files || []) {
    if (!isAllowedConfigPath(file.relativePath)) continue;
    const target = path.resolve(root, normalizeRelativePath(file.relativePath));
    await fsPromises.mkdir(path.dirname(target), { recursive: true });
    const content = Buffer.from(String(file.contentBase64 || ''), 'base64').toString('utf8');
    await fsPromises.writeFile(target, content, 'utf8');
    count += 1;
  }
  return count;
};

/** Streams the file rather than reading it: the point of a checksum is not to copy it. */
export const computeFileChecksum = async (filePath: string): Promise<string> =>
  await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

/**
 * The archive's name, and the reason it is not the uploaded name.
 *
 * The name is built from the type, a timestamp and the id: the import path ends in a
 * real `.ffbkp` name derived from here, so a name that came off an upload is never
 * allowed anywhere near the filesystem.
 */
export const buildFileName = (type: string, id: string, now: Date = new Date()): string => {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${type}_${stamp}_${id.slice(0, 8)}.ffbkp`;
};

/**
 * B16 — write the archive to a temp name and rename it into place.
 *
 * `rename` within a directory is atomic, so a reader sees either the old archive or the
 * new one and never half of one. The length check afterwards is the part that matters:
 * a short file that has been renamed into place is worse than one that was not, because
 * it now has a name, and the name is the promise.
 *
 * This is the v2 body, which takes a string. `ArchiveContainerWriter` in
 * `./archive-container` writes v3 forward instead, and B15-2 leaves this alone so v2
 * keeps working byte for byte.
 */
