/**
 * B15-2 — one authority for archive formats.
 *
 * The properties being pinned here are about *honesty* rather than arithmetic:
 *
 * 1. The default is v2. A build that cannot yet restore v3 must not start writing it,
 *    because that hands an operator an archive the tool cannot open.
 * 2. A misconfigured value is not silently ignored. `BACKUP_ARCHIVE_VERSION=v3` — a
 *    plausible typo — must be visible rather than quietly meaning "v2".
 * 3. The refusal for "newer than this build" says the archive is intact. A valid file
 *    read as damaged is the worst possible answer, because it sends an operator looking
 *    for corruption that is not there.
 * 4. There is one declaration. The signature was previously a constant in the service
 *    and a second constant in the importer, and the two disagreed about whether a
 *    string `"2"` counted as a version.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVE_VERSION_V2,
  ARCHIVE_VERSION_V3,
  BACKUP_EXTENSION,
  BACKUP_SIGNATURE_V2,
  DEFAULT_WRITABLE_ARCHIVE_VERSION,
  INSPECTABLE_ARCHIVE_VERSIONS,
  RESTORABLE_ARCHIVE_VERSIONS,
  archiveFormatMessage,
  configuredVersionIsUnrecognised,
  configuredWritableVersion,
  describeArchiveVersions,
  isInspectableArchiveVersion,
  isRestorableArchiveVersion,
  isReadableArchiveVersion,
} from './archive-format';

// Sibling files, resolved from this module rather than from `process.cwd()`: vitest runs
// with the backend as its root, so a repo-relative path resolves to `backend/backend`.
const here = dirname(fileURLToPath(import.meta.url));
// Comments are stripped before the source guards below. Both files carry a note naming
// the literal they no longer compare against, and a guard that cannot tell prose from
// code is a guard that has to be deleted the first time somebody documents their fix.
const read = (name: string) =>
  readFileSync(resolve(here, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('B15-2 archive format authority', () => {
  describe('what exists and what this build can read', () => {
    it('knows both versions, and reads only the ones it can open', () => {
      expect(ARCHIVE_VERSION_V2).toBe(2);
      expect(ARCHIVE_VERSION_V3).toBe(3);
      // v3 enters these lists when this build can act on it: `restorable` in S3b, once
      // `pg_restore` is fed a member stream, and `inspectable` earlier, as soon as the
      // integrity check can read a container trailer. The gap between them is declared
      // here rather than discovered in production.
      expect(RESTORABLE_ARCHIVE_VERSIONS).toEqual([ARCHIVE_VERSION_V2]);
      expect(INSPECTABLE_ARCHIVE_VERSIONS).toEqual([ARCHIVE_VERSION_V2]);
      expect(isReadableArchiveVersion(ARCHIVE_VERSION_V2)).toBe(true);
      expect(isReadableArchiveVersion(ARCHIVE_VERSION_V3)).toBe(false);
    });

    it('accepts the version as a number or the string a JSON file may carry', () => {
      // The two declarations disagreed here: the importer compared `Number(version)`
      // and the service compared `version !== 2`, so `"2"` passed one and failed the
      // other for the same file.
      expect(isReadableArchiveVersion(2)).toBe(true);
      expect(isReadableArchiveVersion('2')).toBe(true);
    });

    it('refuses anything else', () => {
      for (const value of [1, 3, '3', 0, null, undefined, '', 'two', {}]) {
        expect(isReadableArchiveVersion(value)).toBe(false);
      }
    });
  });

  describe('the switch', () => {
    it('defaults to v2, because a build that cannot restore v3 must not write it', () => {
      expect(DEFAULT_WRITABLE_ARCHIVE_VERSION).toBe(ARCHIVE_VERSION_V2);
      expect(configuredWritableVersion(undefined)).toBe(ARCHIVE_VERSION_V2);
      expect(configuredWritableVersion('')).toBe(ARCHIVE_VERSION_V2);
      expect(configuredWritableVersion('   ')).toBe(ARCHIVE_VERSION_V2);
    });

    it('honours an explicit 3', () => {
      expect(configuredWritableVersion('3')).toBe(ARCHIVE_VERSION_V3);
      expect(configuredWritableVersion(' 2 ')).toBe(ARCHIVE_VERSION_V2);
    });

    it('reports a value it did not recognise instead of swallowing it', () => {
      // `v3` is the typo somebody types. If it quietly meant v2, the change would appear
      // not to work for a year with nobody able to say why.
      expect(configuredVersionIsUnrecognised('v3')).toBe(true);
      expect(configuredVersionIsUnrecognised('4')).toBe(true);
      expect(configuredVersionIsUnrecognised('2')).toBe(false);
      expect(configuredVersionIsUnrecognised('')).toBe(false);
      expect(configuredVersionIsUnrecognised(undefined)).toBe(false);
      expect(configuredWritableVersion('v3')).toBe(ARCHIVE_VERSION_V2);
    });

    it('describes itself for the health endpoint', () => {
      expect(describeArchiveVersions()).toEqual({
        configured: ARCHIVE_VERSION_V2,
        inspectable: [ARCHIVE_VERSION_V2],
        restorable: [ARCHIVE_VERSION_V2],
        defaultWritable: ARCHIVE_VERSION_V2,
        configuredValueRecognised: true,
      });
    });
  });

  describe('the refusal', () => {
    it('says the archive is intact and which versions are readable', () => {
      const message = archiveFormatMessage(ARCHIVE_VERSION_V3);
      expect(message).toContain(String(ARCHIVE_VERSION_V3));
      expect(message).toContain(String(ARCHIVE_VERSION_V2));
      // The sentence that matters: an operator who reads "damaged" will go looking for
      // damage that is not there.
      expect(message).toContain('لم يتلف');
    });

    it('copes with a version it could not even read', () => {
      expect(archiveFormatMessage(null)).toContain('غير معروف');
      expect(archiveFormatMessage(undefined)).toContain('غير معروف');
      expect(archiveFormatMessage('')).toContain('غير معروف');
    });

    it('does not blame the file for a version mismatch', () => {
      expect(archiveFormatMessage(99)).not.toContain('توقيع');
    });
  });

  describe('inspectable is not restorable, and the write is gated on the second', () => {
    it('declares both capabilities separately', () => {
      // "Readable" was one word standing for two different abilities. An archive can be
      // verified without being recoverable, and conflating them is how a system ends up
      // accepting archives it cannot restore — the operator's only copy, useless.
      expect(INSPECTABLE_ARCHIVE_VERSIONS).toEqual([ARCHIVE_VERSION_V2]);
      expect(RESTORABLE_ARCHIVE_VERSIONS).toEqual([ARCHIVE_VERSION_V2]);
      expect(isRestorableArchiveVersion(ARCHIVE_VERSION_V3)).toBe(false);
      expect(isInspectableArchiveVersion(ARCHIVE_VERSION_V3)).toBe(false);
    });

    it('gates writing on restorability, not on inspectability', () => {
      // The whole point of the split: if the gate asked "can I look at this?", adding v3
      // to the inspectable list would start producing archives this build cannot put back.
      expect(isRestorableArchiveVersion(ARCHIVE_VERSION_V2)).toBe(true);
      expect(isRestorableArchiveVersion('2')).toBe(true);
      expect(isRestorableArchiveVersion(99)).toBe(false);
    });

    it('describes both lists for the health endpoint', () => {
      expect(describeArchiveVersions()).toEqual({
        configured: ARCHIVE_VERSION_V2,
        inspectable: [ARCHIVE_VERSION_V2],
        restorable: [ARCHIVE_VERSION_V2],
        defaultWritable: ARCHIVE_VERSION_V2,
        configuredValueRecognised: true,
      });
    });
  });

  describe('one declaration', () => {
    it('the signature and the extension are declared in this file only', () => {
      expect(BACKUP_SIGNATURE_V2).toBe('FFBKUP2');
      expect(BACKUP_EXTENSION).toBe('.ffbkp');

      for (const name of ['backup.service.ts', 'archive-import.ts']) {
        const source = read(name);
        expect(
          source,
          `${name} declares the signature or the extension again. Two declarations of a format are ` +
            'two answers to "what is this file", and these two already disagreed.',
        ).not.toMatch(/=\s*'FFBKUP2'/);
        expect(source, `${name} declares the archive extension again.`).not.toMatch(/=\s*'\.ffbkp'/);
      }
    });

    it('both readers ask this module rather than the version number', () => {
      for (const name of ['backup.service.ts', 'archive-import.ts']) {
        const source = read(name);
        expect(source, `${name} should import from ./archive-format`).toMatch(/from '\.\/archive-format'/);
        expect(
          source,
          `${name} compares a version against a literal. That is the check that drifted.`,
        ).not.toMatch(/version\s*!==\s*2\b/);
      }
    });
  });
});
