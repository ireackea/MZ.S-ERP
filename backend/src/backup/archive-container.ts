/**
 * B15-2 — the streaming archive container, `version: 3`.
 *
 * ## Why this exists
 *
 * A v2 archive is a JSON document with one enormous `payloadBase64` string in it, and
 * the dump inside that string is base64 a second time. Measured on this deployment: a
 * 48 MiB dump drives the process to a 603 MiB RSS, six copies deep —
 *
 *   `pg_dump` stdout · base64 of it · the JSON holding that · the UTF-8 buffer of the
 *   JSON · the ciphertext · the base64 of the ciphertext · the serialised envelope
 *
 * — and the archive itself is 1.778x the dump. Every one of those copies is resident at
 * once, because `execFile` buffers a subprocess and because JSON has no way to say
 * "this field is large, read it in pieces".
 *
 * The consequence is a hard wall rather than a slow degradation. V8 refuses a string
 * longer than 2**29-24 characters, so the archive of a dump above ~288 MiB cannot be
 * represented at all, and the attempt dies inside V8 after several gigabytes have been
 * allocated. B15-0 put a truthful ceiling in front of that wall. This removes the wall:
 * nothing in a v3 archive is ever a string.
 *
 * ## The shape
 *
 * One file, written strictly forward:
 *
 *   "FFBKUP3\0"                 8 bytes, so the format is known before anything is read
 *   u32 headerLength            little-endian
 *   header JSON                 descriptive metadata only. No payload, ever.
 *   member frames, in order     u16 nameLength · name · 12-byte nonce · ciphertext · 16-byte tag
 *   trailer JSON                per-member nonce, tag and SHA-256, plus the payload digest
 *   u32 trailerLength           little-endian, and last, so the file can be walked backwards
 *
 * The header is first on purpose. Listing archives, deciding whether one is restorable
 * and reporting its age must not require decrypting a dump — and under v2 they all did:
 * `readEnvelope` read the entire archive as a string and parsed it to read a `signature`
 * and a `version`.
 *
 * The trailer's length is the *last* four bytes rather than the four before it. Both
 * orders were written and only one of them can be read: to find the trailer you start
 * at the end of the file, so the length has to be the thing you find there. Putting it
 * in front means the reader is reading four bytes of JSON and believes the archive is
 * 2 GB long.
 *
 * Lengths live in the trailer rather than in the frame header because a streamed
 * member's length is not known until it has been written, and the alternative —
 * reserving space and seeking back to fill it — produces containers whose last member
 * silently disagrees with their own table.
 *
 * ## One key, one nonce per member
 *
 * The archive key is derived exactly as it is for v2. What changes is the nonce: each
 * member gets its own random 12 bytes, recorded in the trailer. Two reasons, both about
 * failure rather than speed:
 *
 * 1. A corrupt database member must not make the archive unreadable. Under one GCM
 *    stream a single flipped bit invalidates the tag for everything, so a damaged dump
 *    takes the item names and the schedule with it and the operator is left holding a
 *    file that cannot even be described.
 * 2. A restore can verify a member before trusting it, which is what makes restoring a
 *    subset possible without decrypting the whole archive.
 *
 * The cost is that the trailer is written last, so a truncated archive has no tags to
 * check. That is why `finalize` is the only thing that renames a temp file into place:
 * an interrupted write leaves a temp file, which is never an archive.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { once } from 'node:events';

export const ARCHIVE_MAGIC_V3 = Buffer.from('FFBKUP3\0', 'ascii');
export const ARCHIVE_VERSION_V3 = 3;

/** 1 MiB: large enough that syscall overhead is irrelevant, small enough to be nothing. */
export const DEFAULT_CHUNK_BYTES = 1024 * 1024;

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const NAME_FIELD_BYTES = 2;
const LENGTH_FIELD_BYTES = 4;
/** A header is metadata. Anything past this is a corrupt length prefix, not a header. */
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_TRAILER_BYTES = 4 * 1024 * 1024;

export type ArchiveMemberName = 'meta' | 'database' | 'snapshot' | 'config';

export type ArchiveHeader = {
  signature: 'FFBKUP3';
  version: typeof ARCHIVE_VERSION_V3;
  id: string;
  type: string;
  trigger?: string;
  createdAt: string;
  actor: Record<string, unknown>;
  passwordProtected: boolean;
  keyScope: string;
  masterSecretFingerprint: string;
  /** App version that produced the archive. */
  appVersion?: string;
  /** Prisma schema version, so a restore can refuse an incompatible dump. */
  schemaVersion?: string;
  counts?: Record<string, number> | null;
};

export type ArchiveMemberRecord = {
  name: string;
  /** Bytes of plaintext in this member. */
  plaintextLength: number;
  nonce: string;
  authTag: string;
  /** SHA-256 of the member's plaintext. */
  sha256: string;
};

export type ArchiveTrailer = {
  members: ArchiveMemberRecord[];
  /** SHA-256 over the concatenated member plaintexts: v2's payload digest's analogue. */
  payloadSha256: string;
};

export type ArchiveFormat = 'v2' | 'v3' | 'unknown';

export class ArchiveFormatError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'ArchiveFormatError';
  }
}

/**
 * Which format a file is, from its first bytes alone.
 *
 * The v2 test is the first byte: a v2 archive is a JSON object, so it opens with `{`.
 * That distinction is load-bearing twice over — v2 archives already on disk must keep
 * working, and a build that cannot read v3 has to be able to say so rather than hand
 * binary to `JSON.parse` and report a corrupt archive.
 */
export const detectArchiveFormat = (head: Buffer | null | undefined): ArchiveFormat => {
  if (!head || head.length === 0) return 'unknown';
  if (head.length >= ARCHIVE_MAGIC_V3.length && head.subarray(0, ARCHIVE_MAGIC_V3.length).equals(ARCHIVE_MAGIC_V3)) {
    return 'v3';
  }
  if (head[0] === 0x7b) return 'v2';
  return 'unknown';
};

/** Reads only as many bytes as it takes to classify a file. Never reads the archive. */
export const readArchiveFormat = async (filePath: string): Promise<ArchiveFormat> => {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(ARCHIVE_MAGIC_V3.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return detectArchiveFormat(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

export type ContainerWriterOptions = {
  /** Final destination. Only `finalize` gives a file this name. */
  filePath: string;
  header: Omit<ArchiveHeader, 'signature' | 'version'>;
  /** 32 bytes: the archive key, derived as it is for v2. */
  key: Buffer;
  chunkSize?: number;
  /**
   * Hard ceiling on the bytes written. Exceeding it aborts and deletes the temp file.
   *
   * This replaces `maxBuffer`, which existed only because `execFile` buffers a whole
   * subprocess — it could refuse a dump that was already in memory. A stream has no
   * such backstop, so the limit is enforced while writing.
   */
  maxBytes?: number;
};

type OpenMember = { cipher: ReturnType<typeof createCipheriv>; hash: ReturnType<typeof createHash>; plaintextLength: number };

export class ArchiveContainerWriter {
  private readonly chunkSize: number;
  private readonly out: WriteStream;
  private readonly tempPath: string;
  private readonly records: ArchiveMemberRecord[] = [];
  private readonly payloadHash = createHash('sha256');
  private open: OpenMember | null = null;
  private bytesWritten = 0;
  private finalised = false;

  private constructor(private readonly options: ContainerWriterOptions) {
    if (!Buffer.isBuffer(options.key) || options.key.length !== 32) {
      throw new ArchiveFormatError('the archive key must be 32 bytes', 'KEY_LENGTH');
    }
    this.chunkSize = Math.max(1024, options.chunkSize ?? DEFAULT_CHUNK_BYTES);
    // The same discipline as `writeArchiveAtomically`: the real name is only ever given
    // to a file that was written completely.
    this.tempPath = `${options.filePath}.tmp-${process.pid}-${Date.now()}`;
    this.out = createWriteStream(this.tempPath);
  }

  static async open(options: ContainerWriterOptions): Promise<ArchiveContainerWriter> {
    const writer = new ArchiveContainerWriter(options);
    const header: ArchiveHeader = { signature: 'FFBKUP3', version: ARCHIVE_VERSION_V3, ...options.header };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.length > MAX_HEADER_BYTES) {
      await writer.discard();
      throw new ArchiveFormatError(`the archive header is ${headerBytes.length} bytes`, 'HEADER_TOO_LARGE');
    }
    await writer.emit(Buffer.concat([ARCHIVE_MAGIC_V3, uint32(headerBytes.length), headerBytes]));
    return writer;
  }

  /**
   * Adds one member. The source may be a Buffer, a string, or any async iterable of
   * Buffers — which is how `pg_dump` arrives, once S2 replaces `execFile`.
   */
  async writeMember(name: ArchiveMemberName, source: Buffer | string | AsyncIterable<Buffer>): Promise<ArchiveMemberRecord> {
    if (this.finalised) throw new ArchiveFormatError('this archive is already finalised', 'FINALISED');
    if (this.open) throw new ArchiveFormatError('a member is still being written', 'MEMBER_OPEN');
    if (this.records.some((entry) => entry.name === name)) {
      throw new ArchiveFormatError(`member "${name}" is already in this archive`, 'MEMBER_DUPLICATE');
    }

    const nameBytes = Buffer.from(name, 'ascii');
    if (nameBytes.length > 0xffff) {
      throw new ArchiveFormatError(`member name "${name}" is too long`, 'NAME_LENGTH');
    }

    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.options.key, nonce);
    const member: OpenMember = { cipher, hash: createHash('sha256'), plaintextLength: 0 };
    this.open = member;

    try {
      await this.emit(Buffer.concat([uint16(nameBytes.length), nameBytes, nonce]));
      for await (const chunk of toChunks(source, this.chunkSize)) {
        await this.emit(cipher.update(chunk));
        member.hash.update(chunk);
        member.plaintextLength += chunk.length;
        this.payloadHash.update(chunk);
      }
      const tail = cipher.final();
      if (tail.length) await this.emit(tail);
    } catch (error) {
      // Abandoned rather than finished: a tag written over an incomplete member would
      // authenticate a member that is not there. The temp file goes with it, because a
      // temp file that outlives the failure is how a later run inherits a half archive.
      await this.discard();
      throw error;
    }

    const authTag = cipher.getAuthTag();
    await this.emit(authTag);
    this.open = null;

    const record: ArchiveMemberRecord = {
      name,
      plaintextLength: member.plaintextLength,
      nonce: nonce.toString('base64'),
      authTag: authTag.toString('base64'),
      sha256: member.hash.digest('hex'),
    };
    this.records.push(record);
    return record;
  }

  /** Writes the trailer and gives the file its real name. Nothing else does that. */
  async finalize(): Promise<{ filePath: string; bytesWritten: number; trailer: ArchiveTrailer }> {
    if (this.finalised) throw new ArchiveFormatError('this archive is already finalised', 'FINALISED');
    if (this.open) throw new ArchiveFormatError('a member is still being written', 'MEMBER_OPEN');

    const trailer: ArchiveTrailer = { members: this.records, payloadSha256: this.payloadHash.digest('hex') };
    const trailerBytes = Buffer.from(JSON.stringify(trailer), 'utf8');
    if (trailerBytes.length > MAX_TRAILER_BYTES) {
      await this.discard();
      throw new ArchiveFormatError(`the archive trailer is ${trailerBytes.length} bytes`, 'TRAILER_TOO_LARGE');
    }
    await this.emit(trailerBytes);
    // Length last, not first: see the note on the shape. A reader walking backwards
    // from the end of the file finds the length before it finds anything else.
    await this.emit(uint32(trailerBytes.length));

    this.out.end();
    await once(this.out, 'close');
    this.finalised = true;

    await rename(this.tempPath, this.options.filePath);
    return { filePath: this.options.filePath, bytesWritten: (await stat(this.options.filePath)).size, trailer };
  }

  /**
   * Abandons the archive: the temp file is removed and the real path is never touched.
   *
   * The close is awaited before the unlink, and that ordering is the fix for a race that
   * leaves the very file this is trying to delete. `createWriteStream` opens
   * asynchronously, and `destroy()` does not cancel an open that has not happened yet —
   * so unlinking first can remove nothing, and the handle lands a moment later to
   * create the temp file after the writer has already thrown. Waiting for `close` means
   * either the open was cancelled, or the descriptor is closed and the file is present
   * to be removed. Both orders leave no file behind.
   */
  async discard(): Promise<void> {
    if (this.finalised) return;
    this.open = null;
    this.finalised = true;
    const closed = once(this.out, 'close').then(
      () => undefined,
      () => undefined,
    );
    this.out.destroy();
    await closed;
    await unlink(this.tempPath).catch(() => undefined);
  }

  private async emit(chunk: Buffer): Promise<void> {
    if (!chunk || chunk.length === 0) return;
    this.bytesWritten += chunk.length;
    if (this.options.maxBytes && this.bytesWritten > this.options.maxBytes) {
      await this.discard();
      throw new ArchiveFormatError(
        `the archive passed ${this.options.maxBytes} bytes and was discarded`,
        'ARCHIVE_TOO_LARGE',
      );
    }
    if (!this.out.write(chunk)) {
      await once(this.out, 'drain');
    }
  }
}

/**
 * The archive's descriptive header, without reading or decrypting a member.
 *
 * This is the operation that under v2 meant reading the entire archive into a string.
 * Here it is one seek and a small read.
 */
export const readContainerHeader = async (filePath: string): Promise<ArchiveHeader> => {
  const handle = await open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(ARCHIVE_MAGIC_V3.length + LENGTH_FIELD_BYTES);
    await handle.read(prefix, 0, prefix.length, 0);
    if (detectArchiveFormat(prefix) !== 'v3') {
      throw new ArchiveFormatError('this file is not a v3 container', 'NOT_V3');
    }
    const headerLength = prefix.readUInt32LE(ARCHIVE_MAGIC_V3.length);
    if (!headerLength || headerLength > MAX_HEADER_BYTES) {
      throw new ArchiveFormatError(`implausible header length ${headerLength}`, 'HEADER_LENGTH');
    }
    const headerBytes = Buffer.alloc(headerLength);
    await handle.read(headerBytes, 0, headerLength, ARCHIVE_MAGIC_V3.length + LENGTH_FIELD_BYTES);
    const header = JSON.parse(headerBytes.toString('utf8')) as ArchiveHeader;
    if (header.signature !== 'FFBKUP3' || header.version !== ARCHIVE_VERSION_V3) {
      throw new ArchiveFormatError('the container header does not declare FFBKUP3 v3', 'HEADER_INVALID');
    }
    return header;
  } finally {
    await handle.close();
  }
};

/** The trailer is at the end, so its offset comes from the file size. */
export const readContainerTrailer = async (filePath: string): Promise<ArchiveTrailer> => {
  const size = (await stat(filePath)).size;
  const handle = await open(filePath, 'r');
  try {
    const lengthBuffer = Buffer.alloc(LENGTH_FIELD_BYTES);
    await handle.read(lengthBuffer, 0, LENGTH_FIELD_BYTES, size - LENGTH_FIELD_BYTES);
    const trailerLength = lengthBuffer.readUInt32LE(0);
    if (!trailerLength || trailerLength > MAX_TRAILER_BYTES) {
      throw new ArchiveFormatError(`implausible trailer length ${trailerLength}`, 'TRAILER_LENGTH');
    }
    const trailerBytes = Buffer.alloc(trailerLength);
    await handle.read(trailerBytes, 0, trailerLength, size - LENGTH_FIELD_BYTES - trailerLength);
    return JSON.parse(trailerBytes.toString('utf8')) as ArchiveTrailer;
  } finally {
    await handle.close();
  }
};

/**
 * A member's plaintext, as a stream, with its digest checked when the stream ends.
 *
 * GCM cannot authenticate before it has seen everything, so the check happens at the
 * end of iteration. That is why a streamed restore must be a single transaction: a dump
 * that fails its tag halfway through `pg_restore` would otherwise leave the target
 * database half-replaced, and the tool that was recovering it is what broke it.
 */
export const readContainerMember = async (
  filePath: string,
  name: ArchiveMemberName,
  key: Buffer,
  options: { chunkSize?: number; maxBytes?: number } = {},
): Promise<{ record: ArchiveMemberRecord; plaintext: AsyncIterable<Buffer> }> => {
  const trailer = await readContainerTrailer(filePath);
  const record = trailer.members.find((entry) => entry.name === name);
  if (!record) throw new ArchiveFormatError(`this archive has no "${name}" member`, 'MEMBER_MISSING');

  const chunkSize = Math.max(1024, options.chunkSize ?? DEFAULT_CHUNK_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));

  const start = await memberDataOffset(filePath, trailer, name);
  const size = (await stat(filePath)).size;
  const end = Math.min(size, start + record.plaintextLength) - 1;
  const stream = record.plaintextLength > 0 ? createReadStream(filePath, { start, end, highWaterMark: chunkSize }) : null;

  async function* plaintext(): AsyncGenerator<Buffer> {
    const hash = createHash('sha256');
    let produced = 0;
    if (stream) {
      for await (const chunk of stream) {
        const out = decipher.update(chunk as Buffer);
        produced += out.length;
        hash.update(out);
        if (options.maxBytes && produced > options.maxBytes) {
          throw new ArchiveFormatError(`the "${name}" member passed ${options.maxBytes} bytes`, 'MEMBER_TOO_LARGE');
        }
        if (out.length) yield out;
      }
    }
    const tail = decipher.final();
    if (tail.length) yield tail;

    const digest = hash.digest('hex');
    if (digest !== record.sha256) {
      throw new ArchiveFormatError(`the "${name}" member does not match its recorded digest`, 'MEMBER_CORRUPT');
    }
  }

  return { record, plaintext: plaintext() };
};

/** Where a member's ciphertext begins. Members are sequential, so this walks the frames. */
const memberDataOffset = async (filePath: string, trailer: ArchiveTrailer, name: ArchiveMemberName): Promise<number> => {
  const headerLength = await headerLengthOf(filePath);
  let offset = ARCHIVE_MAGIC_V3.length + LENGTH_FIELD_BYTES + headerLength;
  const handle = await open(filePath, 'r');
  try {
    for (const member of trailer.members) {
      const nameLength = Buffer.alloc(NAME_FIELD_BYTES);
      await handle.read(nameLength, 0, NAME_FIELD_BYTES, offset);
      offset += NAME_FIELD_BYTES + nameLength.readUInt16LE(0) + NONCE_BYTES;
      if (member.name === name) return offset;
      offset += member.plaintextLength + TAG_BYTES;
    }
  } finally {
    await handle.close();
  }
  throw new ArchiveFormatError(`this archive has no "${name}" member`, 'MEMBER_MISSING');
};

const headerLengthOf = async (filePath: string): Promise<number> => {
  const handle = await open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(ARCHIVE_MAGIC_V3.length + LENGTH_FIELD_BYTES);
    await handle.read(prefix, 0, prefix.length, 0);
    return prefix.readUInt32LE(ARCHIVE_MAGIC_V3.length);
  } finally {
    await handle.close();
  }
};

const uint32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(LENGTH_FIELD_BYTES);
  buffer.writeUInt32LE(value, 0);
  return buffer;
};

const uint16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(NAME_FIELD_BYTES);
  buffer.writeUInt16LE(value, 0);
  return buffer;
};

async function* toChunks(source: Buffer | string | AsyncIterable<Buffer>, chunkSize: number): AsyncGenerator<Buffer> {
  if (typeof source === 'string') {
    yield* slice(Buffer.from(source, 'utf8'), chunkSize);
    return;
  }
  if (Buffer.isBuffer(source)) {
    yield* slice(source, chunkSize);
    return;
  }
  for await (const chunk of source) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}

function* slice(buffer: Buffer, chunkSize: number): Generator<Buffer> {
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize));
  }
}
