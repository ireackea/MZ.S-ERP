/**
 * B18/S1 — boundary tests for `./backup-files`.
 *
 * The plan's condition for this move was "a boundary test for each file, before the
 * move". These are those tests. They cover the properties that belong to the module
 * rather than to a caller:
 *
 * - the config allow-list is a security boundary, and the one that decides what a
 *   backup may carry;
 * - `verifySecret` answers "wrong" for a truncated hash instead of throwing, because a
 *   throw there becomes a 500 on a login attempt;
 * - `buildFileName` cannot be talked into producing a path;
 * - `encryptSecret` still derives the historical key, because an archive written
 *   before this module existed has to keep opening.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CONFIG_FILES_ALLOW_LIST,
  buildFileName,
  collectConfigFiles,
  computeFileChecksum,
  decryptSecret,
  encryptSecret,
  hashSecret,
  hashSha256,
  restoreConfigFiles,
  verifySecret,
} from './backup-files';

describe('B18/S1 disk and cryptography primitives', () => {
  describe('hashSha256', () => {
    it('is the plain digest of what it is given, for both a string and a Buffer', () => {
      expect(hashSha256('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
      const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
      expect(hashSha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    });
  });

  describe('the small-secret cipher', () => {
    const master = 'master-secret-value';

    it('round-trips a secret', () => {
      expect(decryptSecret(encryptSecret('the pin', master), master)).toBe('the pin');
    });

    it('produces a different ciphertext every time', () => {
      // A fresh IV per call. Two archives of the same secret must not be identical, or
      // the ciphertext leaks that they are.
      expect(encryptSecret('same', master)).not.toBe(encryptSecret('same', master));
    });

    it('refuses a payload sealed under a different master secret', () => {
      const sealed = encryptSecret('the pin', master);
      expect(() => decryptSecret(sealed, 'a different secret')).toThrow();
    });

    it('answers empty for absent or malformed input rather than throwing', () => {
      expect(decryptSecret(undefined, master)).toBe('');
      expect(decryptSecret('', master)).toBe('');
      expect(decryptSecret('not-three-parts', master)).toBe('');
      expect(decryptSecret('a.b', master)).toBe('');
    });

    it('carries no plaintext in the sealed form', () => {
      expect(encryptSecret('1234', master)).not.toContain('1234');
    });
  });

  describe('hashSecret and verifySecret', () => {
    it('round-trips and salts, so two hashes of one secret differ', () => {
      const first = hashSecret('1234');
      const second = hashSecret('1234');
      expect(first.hash).not.toBe(second.hash);
      expect(first.saltBase64).not.toBe(second.saltBase64);
      expect(verifySecret('1234', first.hash, first.saltBase64)).toBe(true);
    });

    it('says no to the wrong secret', () => {
      const { hash, saltBase64 } = hashSecret('1234');
      expect(verifySecret('1235', hash, saltBase64)).toBe(false);
    });

    it('answers false for a truncated hash instead of throwing', () => {
      // `timingSafeEqual` throws when the two buffers differ in length, and this runs
      // on a login attempt. A throw here is a 500 on a wrong PIN.
      const { saltBase64 } = hashSecret('1234');
      expect(verifySecret('1234', 'deadbeef', saltBase64)).toBe(false);
      expect(verifySecret('1234', '', saltBase64)).toBe(false);
      expect(verifySecret('1234', undefined, undefined)).toBe(false);
      expect(verifySecret('1234', 'zz', saltBase64)).toBe(false);
    });
  });

  describe('the config allow-list', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'ff-files-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('captures only the allow-listed files, and only real files', async () => {
      for (const relativePath of CONFIG_FILES_ALLOW_LIST) {
        const target = path.join(root, relativePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, `content of ${relativePath}`, 'utf8');
      }
      // Things an archive must never pick up.
      writeFileSync(path.join(root, '.env'), 'SECRET=do-not-copy', 'utf8');
      writeFileSync(path.join(root, 'id_rsa'), 'PRIVATE KEY', 'utf8');
      // An allow-listed name that is a directory, not a file.
      mkdirSync(path.join(root, 'server'), { recursive: true });
      writeFileSync(path.join(root, 'server', 'server-data.json.bak'), 'not the file', 'utf8');

      const captured = await collectConfigFiles(root);
      const names = captured.map((entry) => entry.relativePath).sort();

      expect(names).toEqual([...CONFIG_FILES_ALLOW_LIST].sort());
      expect(JSON.stringify(captured)).not.toContain('do-not-copy');
      expect(JSON.stringify(captured)).not.toContain('PRIVATE KEY');
      expect(JSON.stringify(captured)).not.toContain('not the file');
      for (const entry of captured) {
        expect(Buffer.from(entry.contentBase64, 'base64').toString('utf8')).toBe(
          readFileSync(path.join(root, entry.relativePath), 'utf8'),
        );
      }
    });

    it('records the path the same way on every platform', () => {
      // Built with `path.join` this list was `server\server-data.json` on Windows and
      // `server/server-data.json` on Linux, so an archive taken on one was skipped on
      // the other and the restore quietly wrote fewer files than it counted.
      expect(CONFIG_FILES_ALLOW_LIST).toEqual(['metadata.json', 'server/server-data.json']);
      for (const entry of CONFIG_FILES_ALLOW_LIST) {
        expect(entry).not.toContain('\\');
      }
    });

    it('still restores an archive that recorded the old backslash form', async () => {
      const written = await restoreConfigFiles(
        [{ relativePath: 'server\\server-data.json', contentBase64: Buffer.from('legacy', 'utf8').toString('base64') }],
        root,
      );
      expect(written).toBe(1);
      expect(readFileSync(path.join(root, 'server', 'server-data.json'), 'utf8')).toBe('legacy');
    });

    it('skips an allow-listed path that does not exist', async () => {
      expect(await collectConfigFiles(root)).toEqual([]);
    });

    it('refuses a payload naming a file outside the list', async () => {
      // The payload came from an uploaded archive, so a path inside it is an
      // instruction. This is the guard that stops it writing `.env`.
      const restored = await restoreConfigFiles(
        [
          { relativePath: CONFIG_FILES_ALLOW_LIST[0], contentBase64: Buffer.from('legit', 'utf8').toString('base64') },
          { relativePath: '../../evil.txt', contentBase64: Buffer.from('owned', 'utf8').toString('base64') },
          { relativePath: path.join('..', '..', '.env'), contentBase64: Buffer.from('SECRET=x', 'utf8').toString('base64') },
        ],
        root,
      );

      expect(restored).toBe(1);
      expect(readFileSync(path.join(root, CONFIG_FILES_ALLOW_LIST[0]), 'utf8')).toBe('legit');
      expect(existsSync(path.join(root, '..', 'evil.txt'))).toBe(false);
      expect(existsSync(path.join(root, '..', '.env'))).toBe(false);
    });

    it('counts nothing for an empty payload rather than failing', async () => {
      expect(await restoreConfigFiles([], root)).toBe(0);
    });
  });

  describe('computeFileChecksum', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'ff-sum-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('matches the digest of the bytes, for a file larger than one read', async () => {
      // Large enough that a single `readFileSync` would not do, so the streaming claim
      // is the thing under test rather than the arithmetic.
      const target = path.join(root, 'big.bin');
      const bytes = randomBytes(3 * 1024 * 1024);
      writeFileSync(target, bytes);
      expect(await computeFileChecksum(target)).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('rejects a file that is not there instead of answering a digest of nothing', async () => {
      await expect(computeFileChecksum(path.join(root, 'missing.bin'))).rejects.toBeTruthy();
    });
  });

  describe('buildFileName', () => {
    it('cannot be talked into producing a path', () => {
      const name = buildFileName('full', 'abcdef0123456789', new Date('2026-10-07T02:00:00.000Z'));
      expect(name).toBe('full_2026-10-07T02-00-00-000Z_abcdef01.ffbkp');
      expect(path.basename(name)).toBe(name);
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
    });

    it('keeps only the first eight characters of the id', () => {
      // The id is a UUID and the filename is a directory entry, not an identifier to
      // reconstruct from; the manifest row carries the whole id.
      expect(buildFileName('full', 'abcdef0123456789')).toContain('abcdef01');
      expect(buildFileName('full', 'abcdef0123456789')).not.toContain('9');
    });

    it('replaces the characters a filename cannot carry', () => {
      const name = buildFileName('inventory', 'aaaaaaaabbbb', new Date('2026-01-02T03:04:05.678Z'));
      expect(name).toBe('inventory_2026-01-02T03-04-05-678Z_aaaaaaaa.ffbkp');
      expect(name).not.toMatch(/[:*?"<>|]/);
    });
  });
});
