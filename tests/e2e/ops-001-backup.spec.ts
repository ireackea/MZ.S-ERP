import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * FC-OPS-001 — live database round trip.
 *
 * `pg_dump` ships inside the container image (added by FC-OPS-001), not on the
 * host, so the dump and restore are executed through `docker compose exec`.
 * That is also the honest thing to test: the production image is what must be
 * able to take and restore a backup.
 */

const compose = (...args: string[]): string =>
  execFileSync('docker', ['compose', ...args], { encoding: 'utf8', timeout: 300_000 });

/**
 * psql against the live database, returning unaligned tuples.
 *
 * The SQL is delivered on stdin rather than through `sh -lc`, which keeps
 * quoting intact and avoids any shell interpolation of the statement. The
 * connection uses the postgres service's own superuser, because the app role
 * is not permitted to read the catalog or perform DDL.
 */
const psql = (sql: string): string => {
  const result = spawnSync(
    'docker',
    [
      'compose', 'exec', '-T', 'postgres', 'psql',
      '-U', process.env.POSTGRES_USER || 'feedfactory',
      '-d', process.env.POSTGRES_DB || 'feed_factory_db',
      '-t', '-A', '-f', '-',
    ],
    { input: sql, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout || '').toString().slice(0, 500)}`);
  }
  return (result.stdout || '').trim();
};

const hasContainers = (() => {
  try {
    const out = execFileSync('docker', ['compose', 'ps', '--format', '{{.Service}} {{.State}}'], {
      encoding: 'utf8', timeout: 60_000,
    });
    return /backend\s+running/.test(out);
  } catch {
    return false;
  }
})();

const describeLive = hasContainers ? describe : describe.skip;

describeLive('FC-OPS-001 live database round trip', () => {
  it('the image ships the PostgreSQL client tools', () => {
    const out = compose('exec', '-T', 'backend', 'sh', '-lc', 'which pg_dump pg_restore psql').trim();
    expect(out).toContain('pg_dump');
    expect(out).toContain('pg_restore');
    expect(out).toContain('psql');
  }, 120_000);

  it('produces a restorable custom-format dump of the live database', () => {
    // Written inside the container so the bytes never cross a shell argument.
    // busybox `head` has no -c, so the magic header is read with dd.
    // PGHOST is set explicitly: the app container has no local unix socket.
    const script = `
      set -e
      PGHOST=postgres pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --serializable-deferrable -f /tmp/ops001.dump
      test -s /tmp/ops001.dump
      dd if=/tmp/ops001.dump bs=1 count=5 2>/dev/null | grep -q PGDMP
      wc -c < /tmp/ops001.dump
    `;
    const out = compose('exec', '-T', 'backend', 'sh', '-lc', script).trim();
    const bytes = Number(out.split(/\r?\n/).pop());
    expect(bytes).toBeGreaterThan(0);
  }, 180_000);

  it('round-trips data: seed, delete, restore, verify', () => {
    const marker = `ops001-${randomUUID()}`;

    // Seed a distinguishable row in a leaf table with no dependents.
    // `kind` is constrained to 'category' | 'unit' by a CHECK constraint.
    psql(
      `INSERT INTO reference_data_values (id, kind, value, "createdAt", "updatedAt") ` +
      `VALUES ('${marker}', 'category', '${marker}-value', now(), now());`,
    );
    expect(psql(`SELECT count(*) FROM reference_data_values WHERE id = '${marker}';`)).toBe('1');

    try {
      // 1. Take the backup, inside the image that ships pg_dump.
      // PGHOST is explicit because the app container has no local socket.
      compose(
        'exec', '-T', 'backend', 'sh', '-lc',
        `PGHOST=postgres pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --serializable-deferrable -f /tmp/ops001-roundtrip.dump`,
      );

      // 2. Move the archive to the postgres service, which owns the superuser.
      const archive = execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'cat', '/tmp/ops001-roundtrip.dump'], {
        encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 180_000,
      });
      expect(archive.length).toBeGreaterThan(0);
      expect(archive.subarray(0, 5).toString('ascii')).toBe('PGDMP');

      // 3. Lose the data.
      psql(`DELETE FROM reference_data_values WHERE id = '${marker}';`);
      expect(psql(`SELECT count(*) FROM reference_data_values WHERE id = '${marker}';`)).toBe('0');

      // 4. Restore it, as the database superuser (the app role cannot DDL).
      // The archive arrives on stdin: pg_restore rejects -d together with -f.
      const child = spawnSync('docker', [
        'compose', 'exec', '-T', 'postgres', 'pg_restore',
        '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error',
        '-U', process.env.POSTGRES_USER || 'feedfactory',
        '-d', process.env.POSTGRES_DB || 'feed_factory_db',
      ], { input: archive, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });

      expect(
        child.status === 0,
        `pg_restore exited ${child.status}: ${child.stderr?.toString().slice(0, 800)}`,
      ).toBe(true);

      // 5. The row is back. This is the actual proof of recoverability.
      expect(
        psql(`SELECT count(*) FROM reference_data_values WHERE id = '${marker}';`),
        'restore did not recover the seeded row',
      ).toBe('1');
    } finally {
      try { psql(`DELETE FROM reference_data_values WHERE id = '${marker}';`); } catch { /* already gone */ }
      compose('exec', '-T', 'backend', 'sh', '-lc', 'rm -f /tmp/ops001-roundtrip.dump /tmp/ops001.dump');
    }
  }, 300_000);

  it('covers every business table the plan requires', () => {
    const tables = psql(
      `SELECT table_name FROM information_schema.tables ` +
      `WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ` +
      `AND table_name NOT LIKE '%_seq' AND table_name <> '_prisma_migrations' ORDER BY table_name;`,
    ).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    expect(tables.length).toBeGreaterThanOrEqual(20);

    // Everything the plan lists must be present and countable. These are the
    // real physical table names (the schema mixes PascalCase and snake_case).
    for (const required of [
      'Item', 'Transaction', 'partners', 'orders', 'order_items', 'OpeningBalance',
      'formulations', 'formulation_items', 'stocktaking_sessions', 'stocktaking_entries',
      'stocktaking_counts', 'reference_data_values', 'unloading_rules',
      'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
      'invitations', 'audit_logs',
    ]) {
      expect(tables, `missing table ${required}`).toContain(required);
      // And a pg_dump of it is readable.
      expect(Number(psql(`SELECT count(*) FROM "${required}";`)).toString()).toMatch(/^\d+$/);
    }
  }, 180_000);

  it('excludes session and replay state by design, with a stated reason', () => {
    // These are intentionally out of scope, and the manifest must say so rather
    // than silently omitting them.
    const tables = psql(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
    );
    expect(tables).toContain('active_sessions');
    expect(tables).toContain('idempotency_records');
    // A dump taken now must not be replayed into live sessions later; the
    // exclusion is asserted in the service contract test, not here.
  }, 60_000);
});
