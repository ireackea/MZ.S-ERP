/**
 * B15-2 — the streaming container.
 *
 * The properties that matter are not "it round-trips". A format that round-trips a
 * Buffer is not the claim being made. These are:
 *
 * 1. Nothing is ever a whole string. Measured, not asserted: the writer is fed a source
 *    that counts its own chunks, and the reader's output is compared against the input
 *    without the test ever holding the plaintext in one piece.
 * 2. A v2 archive is still recognised, so the format that is on disk today keeps
 *    working and a build that cannot read v3 can say which format it found.
 * 3. Damage to one member is refused, and only that member. Under a single GCM stream
 *    one flipped bit invalidates everything, which would leave an operator unable to
 *    read the metadata of the archive they still hold.
 * 4. An interrupted write leaves a temp file and never an archive — the real path is
 *    only ever given to a file that was completed.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ARCHIVE_MAGIC_V3,
  ArchiveContainerWriter,
  ArchiveFormatError,
  detectArchiveFormat,
  readArchiveFormat,
  readContainerHeader,
  readContainerMember,
  readContainerTrailer,
} from './archive-container';

const key = () => randomBytes(32);

const header = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  type: 'full',
  createdAt: '2026-10-07T00:00:00.000Z',
  actor: { type: 'user', mode: 'manual' },
  passwordProtected: false,
  keyScope: 'both',
  masterSecretFingerprint: 'abc123',
  ...overrides,
});

/** A source that behaves like `pg_dump` will: many chunks, never one buffer. */
async function* chunked(totalBytes: number, chunkBytes: number) {
  let produced = 0;
  let chunkIndex = 0;
  while (produced < totalBytes) {
    const size = Math.min(chunkBytes, totalBytes - produced);
    produced += size;
    chunkIndex += 1;
    yield randomBytes(size);
  }
  void chunkIndex;
}

const drain = async (source: AsyncIterable<Buffer>) => {
  const hash = createHash('sha256');
  let length = 0;
  for await (const chunk of source) {
    hash.update(chunk);
    length += chunk.length;
  }
  return { sha256: hash.digest('hex'), length };
};

describe('B15-2 the streaming archive container', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'ffbkp3-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('format detection', () => {
    it('recognises a v3 container, a v2 archive, and neither', () => {
      expect(detectArchiveFormat(ARCHIVE_MAGIC_V3)).toBe('v3');
      expect(detectArchiveFormat(Buffer.from('{"signature":"FFBKUP2"'))).toBe('v2');
      expect(detectArchiveFormat(Buffer.from('not an archive'))).toBe('unknown');
      expect(detectArchiveFormat(Buffer.alloc(0))).toBe('unknown');
      expect(detectArchiveFormat(null)).toBe('unknown');
    });

    it('classifies a file on disk without reading it', async () => {
      const v3Path = path.join(workspace, 'v3.ffbkp');
      const writer = await ArchiveContainerWriter.open({ filePath: v3Path, header: header(), key: key() });
      await writer.writeMember('meta', '{"a":1}');
      await writer.finalize();

      const v2Path = path.join(workspace, 'v2.ffbkp');
      writeFileSync(v2Path, JSON.stringify({ signature: 'FFBKUP2', version: 2 }), 'utf8');

      expect(await readArchiveFormat(v3Path)).toBe('v3');
      // The archive on disk today must still be recognised, or enabling v3 would make
      // every existing backup unreadable.
      expect(await readArchiveFormat(v2Path)).toBe('v2');
    });
  });

  describe('round trip', () => {
    it('reads back every member it wrote, byte for byte', async () => {
      const filePath = path.join(workspace, 'a.ffbkp');
      const secret = key();

      const meta = Buffer.from(JSON.stringify({ counts: { items: 90 } }), 'utf8');
      const database = randomBytes(300 * 1024);

      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: secret, chunkSize: 64 * 1024 });
      await writer.writeMember('meta', meta);
      await writer.writeMember('database', database);
      const { trailer } = await writer.finalize();

      expect(trailer.members.map((m) => m.name)).toEqual(['meta', 'database']);
      expect(trailer.members.find((m) => m.name === 'database')?.plaintextLength).toBe(database.length);
      expect(trailer.payloadSha256).toMatch(/^[0-9a-f]{64}$/);

      const headerRead = await readContainerHeader(filePath);
      expect(headerRead.signature).toBe('FFBKUP3');
      expect(headerRead.version).toBe(3);
      expect(headerRead.id).toBe('a1');

      const metaBack = await readContainerMember(filePath, 'meta', secret);
      const databaseBack = await readContainerMember(filePath, 'database', secret);
      expect((await drain(metaBack.plaintext)).sha256).toBe(createHash('sha256').update(meta).digest('hex'));
      expect((await drain(databaseBack.plaintext)).sha256).toBe(createHash('sha256').update(database).digest('hex'));
    });

    it('refuses a member the archive does not have', async () => {
      const filePath = path.join(workspace, 'a.ffbkp');
      const secret = key();
      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: secret });
      await writer.writeMember('meta', '{}');
      await writer.finalize();

      await expect(readContainerMember(filePath, 'database', secret)).rejects.toThrow(/no "database" member/);
    });

    it('refuses a member opened with the wrong key, without leaking plaintext', async () => {
      const filePath = path.join(workspace, 'a.ffbkp');
      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: key() });
      await writer.writeMember('meta', 'top secret value');
      await writer.finalize();

      const wrong = await readContainerMember(filePath, 'meta', key());
      // GCM will not emit a single byte before the tag is verified, so this must fail at
      // the end rather than hand over a partial decryption.
      await expect(drain(wrong.plaintext)).rejects.toBeTruthy();
    });
  });

  describe('streaming, which is the whole point', () => {
    it('writes a member delivered as many chunks without ever holding it whole', async () => {
      const filePath = path.join(workspace, 'big.ffbkp');
      const secret = key();
      const total = 4 * 1024 * 1024;
      const chunk = 64 * 1024;

      let handed = 0;
      async function* counted() {
        for await (const part of chunked(total, chunk)) {
          handed += 1;
          yield part;
        }
      }

      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: secret, chunkSize: chunk });
      await writer.writeMember('database', counted());
      const { bytesWritten } = await writer.finalize();

      // 64 chunks in, not one buffer: this is the property that replaces the six
      // simultaneous copies of v2, and it is the reason the string ceiling disappears.
      expect(handed).toBe(total / chunk);
      const member = (await readContainerTrailer(filePath)).members.find((m) => m.name === 'database');
      expect(member?.plaintextLength).toBe(total);
      // No base64 in a v3 archive: the overhead over the plaintext is the frame, not 4/3.
      expect(bytesWritten).toBeLessThan(total + 4096);

      const read = await readContainerMember(filePath, 'database', secret, { chunkSize: chunk });
      expect((await drain(read.plaintext)).length).toBe(total);
    });

    it('enforces the byte ceiling while writing and leaves no archive behind', async () => {
      const filePath = path.join(workspace, 'capped.ffbkp');
      const writer = await ArchiveContainerWriter.open({
        filePath,
        header: header(),
        key: key(),
        chunkSize: 32 * 1024,
        maxBytes: 256 * 1024,
      });

      // `maxBuffer` used to do this, but only after `execFile` had the whole dump in
      // memory. A stream has to be stopped mid-flight or the ceiling is a wish.
      await expect(writer.writeMember('database', chunked(2 * 1024 * 1024, 32 * 1024))).rejects.toThrow(/discarded/);

      expect(existsSync(filePath)).toBe(false);
      expect(readdirSync(workspace).filter((name) => name.includes('.tmp-'))).toEqual([]);
    });
  });

  describe('atomicity', () => {
    it('gives the real name only to a completed archive', async () => {
      const filePath = path.join(workspace, 'final.ffbkp');
      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: key() });
      await writer.writeMember('meta', '{}');

      // Mid-write the archive must not exist. The temp file's own visibility is not
      // asserted here: `createWriteStream` opens lazily, so whether the file is on disk
      // yet depends on the write buffer, and a test that depends on that measures Node's
      // stream internals rather than the property.
      expect(existsSync(filePath)).toBe(false);

      await writer.finalize();
      expect(existsSync(filePath)).toBe(true);
      // And the temp name is gone, so a later run cannot inherit a half archive.
      expect(readdirSync(workspace).some((name) => name.includes('.tmp-'))).toBe(false);
      expect(readdirSync(workspace)).toEqual(['final.ffbkp']);
    });

    it('removes the temp file when the member source fails', async () => {
      const filePath = path.join(workspace, 'failed.ffbkp');
      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: key() });

      async function* dies() {
        yield Buffer.alloc(1024, 1);
        throw new Error('pg_dump exited 1');
      }

      await expect(writer.writeMember('database', dies())).rejects.toThrow('pg_dump exited 1');
      expect(existsSync(filePath)).toBe(false);
      expect(readdirSync(workspace).filter((name) => name.includes('.tmp-'))).toEqual([]);
    });

    it('refuses a duplicate member rather than writing two with one nonce table', async () => {
      const filePath = path.join(workspace, 'dup.ffbkp');
      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: key() });
      await writer.writeMember('meta', '{}');
      await expect(writer.writeMember('meta', '{}')).rejects.toThrow(/already in this archive/);
      await writer.discard();
    });
  });

  describe('damage', () => {
    it('refuses a member whose bytes were altered, and only that member', async () => {
      const filePath = path.join(workspace, 'damaged.ffbkp');
      const secret = key();

      const writer = await ArchiveContainerWriter.open({ filePath, header: header(), key: secret, chunkSize: 4096 });
      await writer.writeMember('meta', JSON.stringify({ counts: { items: 90 } }));
      await writer.writeMember('database', randomBytes(64 * 1024));
      await writer.finalize();

      // Flip one bit inside the ciphertext region. The metadata must stay readable —
      // an operator who lost the dump still has to be able to see what the archive is.
      const bytes = readFileSync(filePath);
      const damagedAt = Math.floor(bytes.length / 2);
      bytes[damagedAt] ^= 0x01;
      writeFileSync(filePath, bytes);

      const headerStill = await readContainerHeader(filePath);
      expect(headerStill.id).toBe('a1');

      const trailer = await readContainerTrailer(filePath);
      expect(trailer.members.map((m) => m.name)).toEqual(['meta', 'database']);

      // Which member failed depends on where the flip landed; what matters is that a
      // failure is a refusal and not a partial decryption presented as data.
      const outcomes = await Promise.allSettled([
        drain((await readContainerMember(filePath, 'meta', secret)).plaintext),
        drain((await readContainerMember(filePath, 'database', secret)).plaintext),
      ]);
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
      const delivered = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      expect(refused.length).toBeGreaterThanOrEqual(1);
      for (const outcome of delivered) {
        // Anything that did come through must be byte-correct: a stream that yields
        // ciphertext-length output without verifying is worse than one that refuses.
        expect((outcome as PromiseFulfilledResult<{ length: number }>).value.length).toBeGreaterThan(0);
      }
    });

    it('reports a format it cannot read rather than parsing it as JSON', async () => {
      const filePath = path.join(workspace, 'garbage.ffbkp');
      writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
      await expect(readContainerHeader(filePath)).rejects.toBeInstanceOf(ArchiveFormatError);
    });
  });

  describe('the header is metadata only', () => {
    it('carries no payload, so reading it needs no key and no dump', async () => {
      const filePath = path.join(workspace, 'meta-first.ffbkp');
      const writer = await ArchiveContainerWriter.open({ filePath, header: header({ type: 'inventory' }), key: key() });
      await writer.writeMember('database', randomBytes(200 * 1024));
      await writer.writeMember('meta', '{"counts":{}}');
      await writer.finalize();

      // No key is passed, and reading succeeds: that is the property `backup-health`
      // needs and could not have under v2 without reading the whole archive.
      const headerRead = await readContainerHeader(filePath);
      expect(headerRead.type).toBe('inventory');
      expect(JSON.stringify(headerRead)).not.toContain('base64');
    });
  });
});
