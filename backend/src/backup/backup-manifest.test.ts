import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManifestStore } from './backup-manifest';

type Row = { id: string; fileName: string };

const read = (dir: string) => new ManifestStore<Row>(path.join(dir, 'manifest.json'), async () => {
  await fsPromises.mkdir(dir, { recursive: true });
});

describe('B18 ManifestStore', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ff-manifest-'));
  });

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  it('reports an absent index as empty, because a first run is not a fault', async () => {
    expect(await read(dir).read()).toEqual([]);
  });

  it('asks the caller to prepare the workspace before touching the file', async () => {
    let prepared = 0;
    const store = new ManifestStore<Row>(path.join(dir, 'manifest.json'), async () => { prepared += 1; });
    await store.read();
    expect(prepared).toBe(1);
  });

  it('round-trips entries through a write and a read', async () => {
    const rows: Row[] = [{ id: 'a', fileName: 'a.ffbkp' }, { id: 'b', fileName: 'b.ffbkp' }];
    await read(dir).write(rows);
    expect(await read(dir).read()).toEqual(rows);
  });

  it('keeps a damaged index and refuses, instead of reporting no backups', async () => {
    const file = path.join(dir, 'manifest.json');
    await fsPromises.writeFile(file, '{ this is not json', 'utf8');

    await expect(read(dir).read()).rejects.toThrow(/unreadable/);

    // The refusal is only half the contract. If the next write overwrote the evidence,
    // the operator would be left with a red screen and no way to find out what happened.
    const kept = (await fsPromises.readdir(dir)).filter((name) => name.includes('.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(await fsPromises.readFile(path.join(dir, kept[0]), 'utf8')).toBe('{ this is not json');
    await expect(fsPromises.access(file)).rejects.toThrow();
  });

  it('names the file it kept, so the message can be acted on', async () => {
    await fsPromises.writeFile(path.join(dir, 'manifest.json'), 'nope', 'utf8');
    await expect(read(dir).read()).rejects.toThrow(/\.corrupt-\d+/);
  });

  it('treats valid JSON that is not an array as damaged too', async () => {
    // `{}` parses cleanly, so a parse-only check would pass it and hand the caller an
    // object where it expects a list — the failure moves downstream and gets blamed there.
    await fsPromises.writeFile(path.join(dir, 'manifest.json'), '{"backups":[]}', 'utf8');
    await expect(read(dir).read()).rejects.toThrow(/not an array/);
  });

  it('never leaves a half-written index where a reader can find it', async () => {
    const dir2 = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ff-manifest-atomic-'));
    try {
      const file = path.join(dir2, 'manifest.json');
      await fsPromises.writeFile(file, '[]', 'utf8');
      const store = new ManifestStore<Row>(file, async () => {});

      const observed: string[] = [];
      let writes = 0;
      const stop = Date.now() + 150;
      const watcher = (async () => {
        while (Date.now() < stop) {
          try {
            observed.push(await fsPromises.readFile(file, 'utf8'));
          } catch {
            // Windows refuses `rename` onto a file a reader holds open, so the tight
            // loop below is really a rename-blocking test on this platform. Neither
            // EPERM nor ENOENT says anything about atomicity, so neither is recorded;
            // the bodies that *were* read are what carry the assertion.
          }
        }
      })();
      for (let i = 0; i < 60; i += 1) {
        await store.write([{ id: String(i), fileName: `${i}.ffbkp` }]).then(() => { writes += 1; }, () => undefined);
      }
      await watcher;

      // Every observation parses. A reader never catches the file mid-replacement, which
      // is the whole reason the write goes through a rename.
      expect(observed.length).toBeGreaterThan(0);
      for (const body of observed) expect(() => JSON.parse(body)).not.toThrow();
      if (process.platform !== 'win32') {
        // Only meaningful where a reader does not block the rename.
        expect(writes).toBe(60);
        expect((await fsPromises.readdir(dir2)).filter((n) => n.includes('.tmp-'))).toEqual([]);
      }
    } finally {
      await fsPromises.rm(dir2, { recursive: true, force: true });
    }
  });

  it('removes its temporary file when the rename fails', async () => {
    const dir2 = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ff-manifest-fail-'));
    try {
      const file = path.join(dir2, 'manifest.json');
      await fsPromises.writeFile(file, '[]', 'utf8');
      const store = new ManifestStore<Row>(file, async () => {});
      // A directory in place of the manifest makes the rename fail on every platform,
      // which is a stand-in for the real thing: a volume that refuses the operation.
      await fsPromises.rm(file);
      await fsPromises.mkdir(file);
      await expect(store.write([{ id: 'x', fileName: 'x.ffbkp' }])).rejects.toThrow();
      expect((await fsPromises.readdir(dir2)).filter((n) => n.includes('.tmp-'))).toEqual([]);
    } finally {
      await fsPromises.rm(dir2, { recursive: true, force: true });
    }
  });
});
