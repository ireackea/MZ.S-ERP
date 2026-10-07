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
      // S3b: this build now restores v3 by streaming members into `pg_restore`, so v3
      // joins both lists. v2 stays — every archive already on disk is v2, and support
      // for it is not optional while those files exist.
      expect(RESTORABLE_ARCHIVE_VERSIONS).toEqual([ARCHIVE_VERSION_V2, ARCHIVE_VERSION_V3]);
      expect(INSPECTABLE_ARCHIVE_VERSIONS).toEqual([ARCHIVE_VERSION_V2, ARCHIVE_VERSION_V3]);
      expect(isReadableArchiveVersion(ARCHIVE_VERSION_V2)).toBe(true);
      expect(isReadableArchiveVersion(ARCHIVE_VERSION_V3)).toBe(true);
      // Still not openable: an unknown version is refused whatever the lists say.
      expect(isReadableArchiveVersion(99)).toBe(false);
    });

    it('accepts the version as a number or the string a JSON file may carry', () => {
      // The two declarations disagreed here: the importer compared `Number(version)`
      // and the service compared `version !== 2`, so `"2"` passed one and failed the
      // other for the same file.
      expect(isReadableArchiveVersion(2)).toBe(true);
      expect(isReadableArchiveVersion('2')).toBe(true);
    });

    it('refuses anything that is not a version this build knows', () => {
      // `3` is no longer in this list: S3b made it restorable. The refusal is about
      // unknown values, not about v3 specifically — an archive claiming a version this
      // build has never heard of is the case the check exists for.
      for (const value of [1, 0, 4, '4', null, undefined, '', 'two', {}]) {
        expect(isReadableArchiveVersion(value)).toBe(false);
      }
    });
  });

  describe('the switch', () => {
    it('defaults to v3, because the round trip has been measured rather than assumed', () => {
      // The default moved off v2 only after a v3 archive written by the product's own
      // API was verified, previewed through the restore endpoint, and restored — with
      // and without a passphrase — to matching row counts. The gate is still
      // RESTORABLE_ARCHIVE_VERSIONS, so a build that cannot restore v3 cannot write it.
      expect(DEFAULT_WRITABLE_ARCHIVE_VERSION).toBe(ARCHIVE_VERSION_V3);
      expect(configuredWritableVersion(undefined)).toBe(ARCHIVE_VERSION_V3);
      expect(configuredWritableVersion('')).toBe(ARCHIVE_VERSION_V3);
      expect(configuredWritableVersion('   ')).toBe(ARCHIVE_VERSION_V3);
    });

    it('honours an explicit 2', () => {
      // v2 stays selectable on purpose: the archives already on disk are v2, and
      // rolling the format back must not become a data-loss event.
      expect(configuredWritableVersion('2')).toBe(ARCHIVE_VERSION_V2);
      expect(configuredWritableVersion(' 2 ')).toBe(ARCHIVE_VERSION_V2);
      expect(configuredWritableVersion('3')).toBe(ARCHIVE_VERSION_V3);
    });

    it('reports a value it did not recognise instead of swallowing it', () => {
      // `v3` is the typo somebody types. If it quietly meant the default, the change
      // would appear not to work for a year with nobody able to say why.
      expect(configuredVersionIsUnrecognised('v3')).toBe(true);
      expect(configuredVersionIsUnrecognised('4')).toBe(true);
      expect(configuredVersionIsUnrecognised('2')).toBe(false);
      expect(configuredVersionIsUnrecognised('')).toBe(false);
      expect(configuredVersionIsUnrecognised(undefined)).toBe(false);
      expect(configuredWritableVersion('v3')).toBe(DEFAULT_WRITABLE_ARCHIVE_VERSION);
    });

    it('describes itself for the health endpoint', () => {
      expect(describeArchiveVersions()).toEqual({
        configured: ARCHIVE_VERSION_V3,
        inspectable: [ARCHIVE_VERSION_V2, ARCHIVE_VERSION_V3],
        restorable: [ARCHIVE_VERSION_V2, ARCHIVE_VERSION_V3],
        defaultWritable: ARCHIVE_VERSION_V3,
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
      // "Readable" was one word standing for two different abilities. They are separate
      // lists because an archive can be verified without being recoverable, and the
      // write is gated on the second so a build can never accept a format it cannot put
      // back into a database.
      expect(INSPECTABLE_ARCHIVE_VERSIONS).toContain(ARCHIVE_VERSION_V2);
      expect(RESTORABLE_ARCHIVE_VERSIONS).toContain(ARCHIVE_VERSION_V2);
      // The property that matters is that the gate never falls back to the weaker list.
      expect(isRestorableArchiveVersion(ARCHIVE_VERSION_V3)).toBe(true);
      expect(isRestorableArchiveVersion(ARCHIVE_VERSION_V2)).toBe(true);
      expect(isRestorableArchiveVersion(99)).toBe(false);
      // v2 is never dropped while archives in that format exist on disk.
      expect(RESTORABLE_ARCHIVE_VERSIONS).toContain(ARCHIVE_VERSION_V2);
    });

    it('gates writing on restorability, not on inspectability', () => {
      // The whole point of the split: if the gate asked "can I look at this?", adding v3
      // to the inspectable list would have started producing archives this build cannot
      // put back — the operator's only copy, useless, with a green badge on it.
      expect(isRestorableArchiveVersion('2')).toBe(true);
      expect(isRestorableArchiveVersion('3')).toBe(true);
      expect(isRestorableArchiveVersion('v3')).toBe(false);
    });

    it('describes both lists for the health endpoint', () => {
      expect(describeArchiveVersions()).toEqual({
        configured: ARCHIVE_VERSION_V3,
        inspectable: [ARCHIVE_VERSION_V2, ARCHIVE_VERSION_V3],
        restorable: [ARCHIVE_VERSION_V2, ARCHIVE_VERSION_V3],
        defaultWritable: ARCHIVE_VERSION_V3,
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
