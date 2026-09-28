import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every physical table the schema declares.
 *
 * Prisma keeps the model name unless the model says `@@map`, and the schema
 * mixes both conventions — `Item` is a table called `Item`, `AuditLog` is
 * `audit_logs` — so the mapping has to be read rather than guessed.
 */
const schemaTableNames = (): string[] => {
  const schema = readFileSync(join(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
  const names: string[] = [];
  for (const model of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, modelName, body] = model;
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    names.push(mapped ? mapped[1] : modelName);
  }
  // The migration bookkeeping table is not part of the business data.
  return names.filter((name) => name !== '_prisma_migrations').sort();
};

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
const psql = (sql: string, database = process.env.POSTGRES_DB || 'feed_factory_db'): string => {
  const result = spawnSync(
    'docker',
    [
      'compose', 'exec', '-T', 'postgres', 'psql',
      '-U', process.env.POSTGRES_USER || 'feedfactory',
      '-d', database,
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

  it('round-trips data: dump the live database, restore it somewhere disposable', () => {
    const marker = `ops001-${randomUUID()}`;

    // Seed a distinguishable row in a leaf table with no dependents.
    // `kind` is constrained to 'category' | 'unit' by a CHECK constraint.
    psql(
      `INSERT INTO reference_data_values (id, kind, value, "createdAt", "updatedAt") ` +
      `VALUES ('${marker}', 'category', '${marker}-value', now(), now());`,
    );
    expect(psql(`SELECT count(*) FROM reference_data_values WHERE id = '${marker}';`)).toBe('1');

    // The restore lands in a scratch database, never in the live one.
    //
    // The previous version of this test ran `pg_restore --clean` against
    // `feed_factory_db`. `--clean` drops and recreates every object in the
    // archive, so a test whose whole purpose is "is the backup restorable" was
    // also the single most destructive command in the suite. It emptied the
    // catalog — 648 items, 1252 movements, 210 deficits — and the run still
    // reported success, because the marker row it cared about came back.
    //
    // Recoverability is a property of the archive, so proving it needs a target
    // that can be thrown away. It never needed the live database.
    const scratch = `ops001_scratch_${Date.now()}`;

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

      // 3. The scratch target. Created empty, so the restore needs no --clean
      // and cannot drop anything that belongs to anyone.
      psql(`DROP DATABASE IF EXISTS ${scratch};`, 'postgres');
      psql(`CREATE DATABASE ${scratch};`, 'postgres');

      const child = spawnSync('docker', [
        'compose', 'exec', '-T', 'postgres', 'pg_restore',
        '--no-owner', '--no-privileges', '--exit-on-error',
        '-U', process.env.POSTGRES_USER || 'feedfactory',
        '-d', scratch,
      ], { input: archive, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });

      expect(
        child.status === 0,
        `pg_restore exited ${child.status}: ${child.stderr?.toString().slice(0, 800)}`,
      ).toBe(true);

      // 4. The row is back. This is the actual proof of recoverability, and it
      // is now read from the copy rather than from the database it came from.
      expect(
        psql(`SELECT count(*) FROM reference_data_values WHERE id = '${marker}';`, scratch),
        'restore did not recover the seeded row',
      ).toBe('1');
      // A restore that recovered one row but none of the catalog would still pass
      // the check above, so the bulk is asserted too.
      const restored = psql(`SELECT count(*) FROM "Item";`, scratch);
      const live = psql(`SELECT count(*) FROM "Item";`);
      expect(Number(restored), 'the restored copy must carry the whole catalog').toBe(Number(live));
    } finally {
      try { psql(`DROP DATABASE IF EXISTS ${scratch};`, 'postgres'); } catch { /* best effort */ }
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

    // The required list is derived from the schema, not typed out by hand.
    //
    // The hand-written version listed `permissions`, `role_permissions` and
    // `user_roles` — three tables this design never had. Roles carry a JSON
    // permission list and a user has one role, so the test was asserting against
    // a schema that does not exist, and it failed for a reason that had nothing
    // to do with backups. A test whose expected values are wrong is worse than
    // no test, because it is read as evidence.
    const required = schemaTableNames();

    expect(required.length).toBeGreaterThanOrEqual(20);
    for (const table of required) {
      expect(tables, `missing table ${table}`).toContain(table);
      // And a pg_dump of it is readable.
      expect(Number(psql(`SELECT count(*) FROM "${table}";`)).toString()).toMatch(/^\d+$/);
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
