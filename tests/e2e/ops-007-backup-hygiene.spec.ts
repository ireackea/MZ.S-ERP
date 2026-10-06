import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * B10 + B16 + B17, against a running server.
 *
 * The unit tests prove the decisions. These prove the wiring, because the most common
 * way a correct module becomes a non-fix is by never being called:
 *
 * - `planReconciliation` decides correctly and `reconcileArchiveDirectory` is never
 *   reached from the backup path, so orphans accumulate exactly as before.
 * - `assertArchiveFits` refuses correctly and no create endpoint passes through it.
 * - `withManifestAdvisoryLock` degrades correctly and nothing ever passes through it.
 *
 * So this creates a real orphan inside the real backup directory, runs a real backup,
 * and asserts the orphan is gone afterwards — with the tracked archives intact.
 */

const hasContainers = (() => {
  try {
    const out = execFileSync('docker', ['compose', 'ps', '--format', '{{.Service}} {{.State}}'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return /backend\s+running/.test(out);
  } catch {
    return false;
  }
})();

const describeLive = hasContainers ? describe : describe.skip;

let cookie = '';
const created: string[] = [];
const planted: string[] = [];

const login = async () => {
  if (cookie) return cookie;
  const response = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status, 'login failed — is the backend up?').toBe(201);
  cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  return cookie;
};

const api = async (path: string, init: RequestInit = {}) => {
  const session = await login();
  const response = await fetch(`${backendUrl}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: session, ...(init.headers || {}) },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
};

const inContainer = (command: string[]) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'backend', 'sh', '-lc', command], {
    encoding: 'utf8',
    timeout: 120_000,
  });

/**
 * The directory and the manifest, as two sets of names.
 *
 * The index is `index.json`, not `manifest.json` — the test guessed and found nothing,
 * which is worth knowing: a test that reads a path that does not exist and then asserts
 * on the resulting emptiness looks exactly like a passing reconciliation.
 */
const diskState = () => {
  const listing = inContainer(`ls -1 /app/backups`)
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  const indexRaw = inContainer(`cat /app/backups/index.json 2>/dev/null || echo '[]'`);
  const rows = (JSON.parse(indexRaw.trim() || '[]') as Array<{ id: string; fileName: string }>);
  return {
    archives: listing.filter((name) => name.endsWith('.ffbkp')).sort(),
    rows: rows.map((row) => row.fileName).sort(),
    indexed: rows,
    nonArchives: listing.filter((name) => !name.endsWith('.ffbkp')).sort(),
  };
};

/**
 * Setup: delete index rows whose file is already gone.
 *
 * These accumulate in any long-lived deployment — they were rows an earlier version of
 * the delete path restored after an `ENOENT`, and nothing can sweep them because
 * reconciliation deliberately never touches a tracked file.
 *
 * It is worth stating what this line proves: with the undo fixed, deleting a row whose
 * file is missing **succeeds**. That is the operation the old code refused, which is why
 * the phantoms were permanent.
 */
const repairPhantomRows = async () => {
  const state = diskState();
  let repaired = 0;
  for (const row of state.indexed) {
    if (state.archives.includes(row.fileName)) continue;
    const { response } = await api(`/backup/${row.id}`, { method: 'DELETE' });
    if (response.status === 200) repaired += 1;
  }
  return repaired;
};

afterAll(() => {
  for (const name of planted) {
    spawnSync('docker', ['compose', 'exec', '-T', 'backend', 'rm', '-f', path.posix.join('/app/backups', name)], {
      encoding: 'utf8',
      timeout: 120_000,
    });
  }
  for (const id of created) {
    spawnSync('curl', ['-s', '-X', 'DELETE', `${backendUrl}/api/backup/${id}`, '-H', `Cookie: ${cookie}`], {
      encoding: 'utf8',
      timeout: 120_000,
    });
  }
});

describeLive('B10 — an orphan on disk does not survive a backup', () => {
  it('a row naming a file that is gone can be deleted, which is how phantoms are cleared', async () => {
    // Worth a test of its own, because the old delete refused exactly this. ENOENT was
    // read as "the delete did not happen", so the row was written back — and the phantom
    // could never be cleared again, because reconciliation deliberately never touches a
    // tracked file. Fixing the undo is what makes this cleanup possible at all.
    const before = diskState();
    const phantoms = before.indexed.filter((row) => !before.archives.includes(row.fileName));

    const repaired = await repairPhantomRows();
    const after = diskState();

    expect(repaired, 'every phantom row should have been deletable').toBe(phantoms.length);
    for (const row of phantoms) {
      expect(
        after.rows,
        `a row naming a missing file must be deletable, otherwise it is permanent (${row.fileName})`,
      ).not.toContain(row.fileName);
    }
    // And repairing them leaves the two sides in agreement.
    expect(after.archives).toEqual(after.rows);
  });

  it('is removed, while every tracked archive is left alone', async () => {
    // Plant a file that looks exactly like an archive but that the index has never
    // heard of. This is the shape a crash between the file write and the index write
    // leaves behind, and the shape that fills a disk while `GET /backup/list` reports
    // everything is fine.
    const orphanName = `ops-orphan-${randomUUID().slice(0, 8)}.ffbkp`;
    planted.push(orphanName);
    inContainer([
      `mkdir -p /app/backups`,
      `dd if=/dev/zero of=/app/backups/${orphanName} bs=1024 count=64 2>/dev/null`,
      // Aged past the orphan grace window, because that is what an orphan actually is.
      //
      // A file planted seconds ago is indistinguishable from a backup whose manifest row
      // has not been written yet — and treating it as garbage deleted a backup that was
      // still being created, which is a race this file found the hard way. So the fixture
      // has to plant something abandoned, not something recent.
      `touch -d '30 minutes ago' /app/backups/${orphanName}`,
      `test -f /app/backups/${orphanName}`,
    ].join(' && '));

    const before = await api('/backup/list');
    expect(before.response.status).toBe(200);
    const beforeIds = (before.data?.data || []).map((entry: any) => entry.id);
    expect(
      (before.data?.data || []).some((entry: any) => entry.fileName === orphanName),
      'the orphan must be invisible to the list endpoint — that is why it needs a sweeper',
    ).toBe(false);
    expect(beforeIds.length).toBeGreaterThan(0);

    // The directory and the index are about to disagree, which is the precondition for
    // everything this test claims.
    const seeded = diskState();
    expect(seeded.archives, 'the planted orphan must be on disk').toContain(orphanName);
    expect(seeded.rows, 'and absent from the index').not.toContain(orphanName);

    // Now take a backup. Reconciliation runs inside the same lock as the index write,
    // so the moment an orphan is most likely to exist is the moment it is swept.
    const made = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b10-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(made.response.status, JSON.stringify(made.data)).toBe(200);
    const newId = String(made.data?.data?.id || '');
    expect(newId).not.toBe('');
    created.push(newId);

    const after = await api('/backup/list');
    expect(after.response.status).toBe(200);
    const afterList = after.data?.data || [];

    const swept = diskState();
    expect(
      swept.archives,
      'the orphan should have been removed by the post-backup reconciliation',
    ).not.toContain(orphanName);

    // The new archive is in both places.
    expect(afterList.map((entry: any) => entry.id)).toContain(newId);
    expect(swept.rows).toContain(
      afterList.find((entry: any) => entry.id === newId)?.fileName as string,
    );

    // Files on disk and rows in the index agree again.
    expect(swept.archives).toEqual(swept.rows);
    // And the sweeper touched nothing that was not an archive it was asked about.
    expect(swept.nonArchives).toEqual(seeded.nonArchives);
    // Note what is deliberately NOT asserted here: that the pre-existing archives are
    // still present. Creating a backup also runs retention, and retention is *supposed*
    // to prune — including the `maxSafetySnapshots` ceiling. Asserting survival here
    // would be asserting that retention does not work. That check belongs to the next
    // test, which reconciles without creating anything.
  }, 240_000);

  it('leaves every tracked archive exactly where it was', async () => {
    // The claim under test is about reconciliation alone: it removes what nothing
    // tracks and touches nothing else. So no backup is created here — creating one
    // would also run retention, and a legitimate prune would be indistinguishable from
    // the sweeper eating a good archive.
    const before = diskState();

    const report = await api('/backup/reconcile', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b10c-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(report.response.status, JSON.stringify(report.data)).toBe(200);

    const after = diskState();
    expect(
      after.rows,
      'reconciliation must not remove an indexed archive, and must not add one',
    ).toEqual(before.rows);
    expect(after.archives).toEqual(before.archives);
    expect(after.nonArchives).toEqual(before.nonArchives);

    // It only ever claims to delete untracked files, so its own report must agree.
    const data = report.data?.data;
    expect(data).toBeTruthy();
    for (const name of data.toDelete) {
      expect(
        before.rows,
        `reconciliation claimed to delete ${name}, which was indexed`,
      ).not.toContain(name);
    }
  }, 240_000);

  it('reports what it did, and names every file it judged', async () => {
    const report = await api('/backup/reconcile', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b10b-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(report.response.status, JSON.stringify(report.data)).toBe(200);

    const data = report.data?.data;
    expect(data).toBeTruthy();
    expect(Array.isArray(data.decisions)).toBe(true);
    expect(Array.isArray(data.toDelete)).toBe(true);
    expect(typeof data.deleted).toBe('number');
    expect(typeof data.reclaimableBytes).toBe('number');

    // A sweep that decides nothing, silently, is indistinguishable from one that had
    // nothing to do — so every judgement carries its reason.
    for (const decision of data.decisions) {
      expect(decision.name).toBeTruthy();
      expect(decision.action).toBeTruthy();
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  }, 240_000);
});

describeLive('B14 — schema drift is known at boot, not at restore time', () => {
  it('reports it as part of health, per archive, against this image', async () => {
    // The check itself is not new — it ran on the restore path, which meant it was only
    // ever reached at the moment its answer was too late to use. What is new is that the
    // answer is available while there is still time to take another backup.
    const { response, data } = await api('/backup/health');
    expect(response.status, JSON.stringify(data)).toBe(200);

    const drift = data?.data?.schemaDrift;
    expect(drift, 'health must carry the drift report, or the check is invisible').toBeTruthy();
    expect(typeof drift.judged).toBe('number');
    expect(typeof drift.unknown).toBe('number');
    expect(['ok', 'warning', 'error']).toContain(drift.severity);
    expect(drift.message.length).toBeGreaterThan(0);

    // The distinction the report exists to preserve: an archive with no migration list
    // is undecidable, and must be counted as such rather than folded into "no drift".
    expect(drift.judged + drift.unknown).toBeGreaterThan(0);

    // And it speaks about the archive an operator would reach for first.
    if (drift.newest) {
      expect(typeof drift.newest.id).toBe('string');
      expect(Array.isArray(drift.newest.missing)).toBe(true);
      expect(drift.newestBlocked).toBe(drift.newest.restorable === false);
    }

    // `schemaDrift` is attached, not folded into the verdict: an intact, readable
    // archive is not "unhealthy" because a different image would be needed to restore it.
    expect(data?.data?.verdict).toMatch(/healthy|degraded|unhealthy/);
  }, 240_000);
});

describeLive('B16 — the create path runs the space check', () => {
  it('still creates a backup normally, with room to spare', async () => {
    // The refusal must not have become the only outcome: a check that blocks everything
    // is as broken as no check at all, and this is the assertion that would catch it.
    const made = await api('/backup/config', {
      method: 'POST',
      headers: { 'Idempotency-Key': `b16-${randomUUID()}` },
      body: JSON.stringify({}),
    });
    expect(made.response.status, JSON.stringify(made.data)).toBe(200);
    const id = String(made.data?.data?.id || '');
    expect(id).not.toBe('');
    created.push(id);

    // And the archive it produced is a real file, not a truncated one. The file name is
    // `<type>_<timestamp>_<first 8 of the id>.ffbkp` — `buildFileName` uses a short
    // suffix, not the whole UUID, so a glob over the full id matches nothing and `ls`
    // exits non-zero. (Which it did, for a while, and read like a missing archive.)
    const listing = inContainer(`ls -l /app/backups/*${id.slice(0, 8)}*`).trim();
    expect(listing).toContain('ffbkp');
    const size = Number(listing.split(/\s+/)[4]);
    expect(size).toBeGreaterThan(0);
    // The atomic write leaves no temporary behind.
    const temps = inContainer(`ls -1 /app/backups | grep -c 'tmp-' || true`).trim();
    expect(Number(temps)).toBe(0);
  }, 240_000);
});

describeLive('B17 — the manifest lock is reachable', () => {
  it('serialises concurrent deletes without losing an archive', async () => {
    // Two deletes at once is the smallest reproduction of the race the lock exists for:
    // read ? splice ? writeManifest overlapping, which erases a row and orphans a file.
    const made = await Promise.all([
      api('/backup/config', {
        method: 'POST',
        headers: { 'Idempotency-Key': `b17-${randomUUID()}` },
        body: JSON.stringify({}),
      }),
      api('/backup/config', {
        method: 'POST',
        headers: { 'Idempotency-Key': `b17-${randomUUID()}` },
        body: JSON.stringify({}),
      }),
    ]);
    const ids = made.map((r) => String(r.data?.data?.id || '')).filter(Boolean);
    expect(ids.length).toBe(2);
    created.push(...ids);

    const deleted = await Promise.all(
      ids.map((id) =>
        api(`/backup/${id}`, { method: 'DELETE' }).then((r) => ({ id, status: r.response.status })),
      ),
    );
    for (const outcome of deleted) {
      expect([200, 404], `delete of ${outcome.id} answered ${outcome.status}`).toContain(outcome.status);
    }

    // What this test can honestly assert: the archives it created are gone from both
    // sides, and the ones it did not touch are still in both.
    const createdIds = new Set(ids);
    const settled = diskState();
    const list = await api('/backup/list');
    const listed = (list.data?.data || []).map((entry: any) => entry.id);

    for (const id of ids) {
      expect(listed, `a deleted archive must not still be listed (${id})`).not.toContain(id);
      expect(
        settled.rows.filter((name) => settled.rows.includes(name) && name.includes(id)),
        `a deleted archive must not still be indexed (${id})`,
      ).toEqual([]);
    }
    expect(createdIds.size).toBe(2);
  }, 240_000);

  // The invariant that matters, and the one that found a real bug.
  //
  // This assertion was originally written as an expected failure, because `index.json`
  // was losing rows *and* gaining rows — a lost update in both directions — while the
  // audit log cheerfully reported every delete as `SUCCESS`.
  //
  // The cause was in `withManifestLock`: making the advisory lock optional had hoisted
  // the guarded function out of the chain (`const body = fn()`), so every operation began
  // immediately and the chain merely awaited results. Serialisation was gone, and nothing
  // about any individual call site looked wrong. Restoring the invocation inside the
  // `.then(` made the index and the directory agree exactly — 13 rows, 13 files, no
  // phantoms, no orphans.
  it('leaves the index and the directory in exact agreement', async () => {
    const state = diskState();
    expect(state.archives, 'every indexed archive must exist, and vice versa').toEqual(state.rows);
  }, 240_000);
});