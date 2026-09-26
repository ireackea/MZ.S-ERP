import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DatabaseDumpError,
  MAX_DUMP_BYTES,
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
    expect(MAX_DUMP_BYTES).toBeGreaterThan(0);
    expect(MAX_DUMP_BYTES).toBeLessThanOrEqual(1024 * 1024 * 1024);
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
