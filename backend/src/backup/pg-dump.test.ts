import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DatabaseDumpError,
  MAX_DUMP_BYTES,
  BACKUP_MAX_PEAK_BYTES,
  CONFIGURED_MAX_DUMP_BYTES,
  DUMP_PEAK_FACTOR,
  PEAK_CEILING_DUMP_BYTES,
  STRING_CEILING_DUMP_BYTES,
  V8_MAX_STRING_LENGTH,
  base64ByteLength,
  describeDumpCeiling,
  dumpTooLargeMessage,
  isPostgresUrl,
  isValidCustomDump,
  parsePostgresUrl,
} from './pg-dump';

describe('FC-OPS-001 PostgreSQL dump contract', () => {
  describe('URL detection', () => {
    it('recognises PostgreSQL and rejects anything else', () => {
      expect(isPostgresUrl('postgresql://user:pw@localhost:5432/db')).toBe(true);
      expect(isPostgresUrl('postgres://user:pw@host/db')).toBe(true);
      expect(isPostgresUrl('file:./dev.db')).toBe(false);
      expect(isPostgresUrl('')).toBe(false);
    });
  });

  describe('URL parsing', () => {
    it('extracts every field the dump tools need', () => {
      const parsed = parsePostgresUrl('postgresql://app:s3cr3t@db.internal:6543/feed_factory_db');
      expect(parsed).toEqual({
        host: 'db.internal',
        port: 6543,
        user: 'app',
        password: 's3cr3t',
        database: 'feed_factory_db',
        socketDir: undefined,
      });
    });

    it('defaults the port and user', () => {
      const parsed = parsePostgresUrl('postgresql://localhost/feed');
      expect(parsed.port).toBe(5432);
      expect(parsed.user).toBe('postgres');
    });

    it('decodes percent-encoded credentials and names', () => {
      const parsed = parsePostgresUrl('postgresql://a%40b:p%40ss%2Fword@localhost:5432/feed%20db');
      expect(parsed.user).toBe('a@b');
      expect(parsed.password).toBe('p@ss/word');
      expect(parsed.database).toBe('feed db');
    });

    it('supports the unix-socket form used by ?host=', () => {
      const parsed = parsePostgresUrl('postgresql:///feed?host=/var/run/postgresql');
      expect(parsed.socketDir).toBe('/var/run/postgresql');
      expect(parsed.database).toBe('feed');
    });

    it('refuses a non-PostgreSQL or malformed URL', () => {
      expect(() => parsePostgresUrl('file:./dev.db')).toThrow(DatabaseDumpError);
      expect(() => parsePostgresUrl('not a url')).toThrow(DatabaseDumpError);
      expect(() => parsePostgresUrl('postgresql://localhost/')).toThrow(/database name/i);
    });
  });

  describe('dump validation', () => {
    it('accepts a real pg_dump custom archive header', () => {
      const header = Buffer.concat([Buffer.from('PGDMP', 'ascii'), Buffer.alloc(64, 0)]);
      expect(isValidCustomDump(header.toString('base64'))).toBe(true);
    });

    it('rejects a plain SQL dump and empty input', () => {
      const sql = Buffer.from('CREATE TABLE items (id int);', 'ascii');
      expect(isValidCustomDump(sql.toString('base64'))).toBe(false);
      expect(isValidCustomDump('')).toBe(false);
      expect(isValidCustomDump(Buffer.alloc(0).toString('base64'))).toBe(false);
    });
  });

  it('bounds the dump size so a runaway database cannot exhaust memory', () => {
    // The old assertion was `> 0` and `<= 1 GiB`, which passes at 512 MiB — the very
    // number the code could not honour. B15-0 makes the ceiling derived, so it is
    // checked against the walls that produce it.
    expect(MAX_DUMP_BYTES).toBeGreaterThan(0);
    expect(MAX_DUMP_BYTES).toBeLessThanOrEqual(CONFIGURED_MAX_DUMP_BYTES);
    expect(MAX_DUMP_BYTES).toBeLessThanOrEqual(STRING_CEILING_DUMP_BYTES);
    expect(MAX_DUMP_BYTES).toBeLessThanOrEqual(PEAK_CEILING_DUMP_BYTES);
  });

  describe('B15-0 the dump ceiling is a wall the archive actually hits', () => {
    it('knows the longest string this runtime can hold', () => {
      // Measured on the runtime this deployment uses: 2**29 - 24 characters.
      expect(V8_MAX_STRING_LENGTH).toBe(536870888);
    });

    it('never allows a dump whose base64-twice archive cannot be a string', () => {
      // The archive is the dump base64'd twice (ENCODED_COST ≈ 1.778). A dump at the
      // ceiling must still fit inside V8's string limit, or the backup dies at
      // `encrypted.toString('base64')` with `RangeError: Invalid string length`.
      expect(STRING_CEILING_DUMP_BYTES * (16 / 9)).toBeLessThan(V8_MAX_STRING_LENGTH);
      // The ceiling this replaces claimed 512 MiB and needed ~288 MiB.
      expect(STRING_CEILING_DUMP_BYTES).toBeLessThan(CONFIGURED_MAX_DUMP_BYTES);
    });

    it('never allows a dump whose peak leaves the declared budget', () => {
      expect(PEAK_CEILING_DUMP_BYTES).toBe(Math.floor(BACKUP_MAX_PEAK_BYTES / DUMP_PEAK_FACTOR));
      expect(MAX_DUMP_BYTES * DUMP_PEAK_FACTOR).toBeLessThanOrEqual(BACKUP_MAX_PEAK_BYTES);
      // The factor is measured (a 48 MiB dump peaked at 603 MiB = 12.6x) and rounded
      // up. A factor below the measurement would promise memory this runtime does not
      // use, which is the defect B15-0 exists to remove.
      expect(DUMP_PEAK_FACTOR).toBeGreaterThanOrEqual(13);
    });

    it('says which wall refused, and says it before the dump is archived', () => {
      const ceiling = describeDumpCeiling();
      expect(['configured', 'string-length', 'memory-budget']).toContain(ceiling.boundBy);
      expect(ceiling.reason).toBeTruthy();

      const message = dumpTooLargeMessage(ceiling.bytes + 1024, ceiling);
      // The two numbers an operator needs, and no raw RangeError from inside V8.
      expect(message).toContain('أكبر من الحد المسموح');
      expect(message).toContain(ceiling.reason);
      expect(message).not.toMatch(/RangeError|Invalid string length/);
    });
  });

  describe('B15-0 base64 length without decoding the payload', () => {
    it('is exact where floor(length * 3 / 4) overstates it', () => {
      // The manifest field is compared against a measured file size, and the headroom
      // estimate is the last thing standing between a backup and a full disk.
      expect(base64ByteLength('')).toBe(0);
      expect(base64ByteLength(undefined)).toBe(0);
      expect(base64ByteLength(Buffer.from('a').toString('base64'))).toBe(1);
      expect(base64ByteLength(Buffer.from('ab').toString('base64'))).toBe(2);
      expect(base64ByteLength(Buffer.from('abc').toString('base64'))).toBe(3);
      expect(base64ByteLength(Buffer.from('abcd').toString('base64'))).toBe(4);
      expect(base64ByteLength(Buffer.alloc(1000, 0x41).toString('base64'))).toBe(1000);
      // The expression this replaced, on a padded input, is two bytes out.
      expect(Math.floor((4 * 3) / 4)).toBe(3);
      expect(base64ByteLength('YQ==')).toBe(1);
    });
  });

  it('never puts the password on the command line', () => {
    // The password is passed via PGPASSWORD, so a `ps` snapshot of the process
    // table cannot reveal it.
    const parsed = parsePostgresUrl('postgresql://app:s3cr3t@localhost:5432/feed');
    expect(parsed.password).toBe('s3cr3t');

    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'pg-dump.ts'), 'utf8');
    // The credential is only ever written to the environment block.
    expect(source).toMatch(/PGPASSWORD:\s*parsed\.password/);
    // No argv entry may carry it.
    expect(source).not.toMatch(/args\.push\(\s*['"`][^'"`]*password/i);
    expect(source).not.toMatch(/--(password|pw)['"`]/);
  });
});
