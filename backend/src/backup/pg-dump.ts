/**
 * FC-OPS-001 — PostgreSQL dump/restore.
 *
 * `backup.service` previously asked for a *SQLite* file path, which can never
 * resolve on a PostgreSQL deployment, so a "full" backup silently degraded to a
 * partial JSON snapshot and no database was ever copied. This module is the
 * real path: `pg_dump` / `pg_restore` against the configured PostgreSQL URL.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ENCODED_COST } from './disk-headroom';

const run = promisify(execFile);

export type PgDumpFormat = 'custom' | 'plain';

export type PgDumpResult = {
  /** The dump bytes, base64-encoded for transport inside the backup payload. */
  base64: string;
  format: PgDumpFormat;
  byteLength: number;
};

/**
 * B15-0 — the longest string this runtime can hold: `2**29 - 24` characters.
 *
 * Measured, not assumed: `'a'.repeat(536870888)` succeeds and
 * `'a'.repeat(536870889)` throws `RangeError: Invalid string length`.
 */
export const V8_MAX_STRING_LENGTH = 2 ** 29 - 24;

/**
 * B15-0 — peak memory per byte of dump, measured on this runtime.
 *
 * A 48 MiB dump drove the process to a 603 MiB RSS: the `pg_dump` stdout buffer, the
 * base64 copy of it, the JSON holding that, the UTF-8 buffer of the JSON, the
 * ciphertext, and the base64 of the ciphertext — six copies, 12.6x. Rounded up to 13
 * because a factor that is exactly right is a factor that fails on the day the dump
 * compresses differently.
 *
 * This number is the reason the ceiling below is not the number the catalogue used
 * to advertise. It goes away in B15-2, when the archive is written as a stream and
 * nothing but a chunk is ever resident.
 */
export const DUMP_PEAK_FACTOR = 13;

/** The declared memory budget for one backup. Overridable, but never unbounded. */
export const BACKUP_MAX_PEAK_BYTES = envInt('BACKUP_MAX_PEAK_BYTES', 3 * 1024 * 1024 * 1024);

/** The ceiling the configured limit used to claim: 512 MiB. */
export const CONFIGURED_MAX_DUMP_BYTES = envInt('BACKUP_MAX_DUMP_BYTES', 512 * 1024 * 1024);

/**
 * The dump size whose archive still fits in one string.
 *
 * The archive is base64 twice (`ENCODED_COST`, ≈1.778x), so this is where
 * `encrypted.toString('base64')` stops being representable: ≈288 MiB, against the
 * 512 MiB the code used to allow. Everything above this line failed with a raw
 * `RangeError` from inside V8, after the dump had already been taken and roughly six
 * gigabytes had been allocated.
 */
export const STRING_CEILING_DUMP_BYTES = Math.floor(V8_MAX_STRING_LENGTH / ENCODED_COST);

/** The dump size whose peak stays inside the declared budget. */
export const PEAK_CEILING_DUMP_BYTES = Math.floor(BACKUP_MAX_PEAK_BYTES / DUMP_PEAK_FACTOR);

export const MAX_DUMP_BYTES = Math.max(
  16 * 1024 * 1024,
  Math.min(CONFIGURED_MAX_DUMP_BYTES, STRING_CEILING_DUMP_BYTES, PEAK_CEILING_DUMP_BYTES),
);

export type DumpCeiling = {
  bytes: number;
  /** Which of the three walls set the ceiling, for a message an operator can act on. */
  boundBy: 'configured' | 'string-length' | 'memory-budget';
  /** Why this wall, in the operator's language. */
  reason: string;
};

export const describeDumpCeiling = (): DumpCeiling => {
  if (MAX_DUMP_BYTES === PEAK_CEILING_DUMP_BYTES) {
    return {
      bytes: MAX_DUMP_BYTES,
      boundBy: 'memory-budget',
      reason: 'وهو ما يسمح به سقف الذاكرة المعلن، لأن النسخة تُحمل في الذاكرة كاملة',
    };
  }
  if (MAX_DUMP_BYTES === STRING_CEILING_DUMP_BYTES) {
    return {
      bytes: MAX_DUMP_BYTES,
      boundBy: 'string-length',
      reason: 'لأن الأرشيف يُخزَّن كنص، والحد الأقصى لطول النص في هذا التشغيل أصغر',
    };
  }
  return { bytes: MAX_DUMP_BYTES, boundBy: 'configured', reason: 'وهو ما ضبطته في الإعدادات' };
};

export const mibLabel = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MiB`;

export const dumpTooLargeMessage = (actualBytes: number, ceiling: DumpCeiling = describeDumpCeiling()) =>
  `النسخة أكبر من الحد المسموح: التفريغ ${mibLabel(actualBytes)} والحد ${mibLabel(ceiling.bytes)}، ${ceiling.reason}. ` +
  'قاعدة البيانات نفسها لم تتأثر. ' +
  'ارفع BACKUP_MAX_PEAK_BYTES إن كانت الذاكرة كافية، أو صدّر نسخة من pg_dump مباشرة إلى قرص خارجي.';

/**
 * The exact decoded length of a base64 string.
 *
 * `Math.floor(length * 3 / 4)` overstates a padded string by up to two bytes, which
 * is invisible in a headroom estimate and wrong in a manifest field that is compared
 * against a measured file size.
 */
export const base64ByteLength = (value: unknown): number => {
  const text = String(value ?? '');
  if (!text.length) return 0;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
};

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export type ParsedDatabaseUrl = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Host-side socket directory, when the URL uses the unix socket form. */
  socketDir?: string;
};

export class DatabaseDumpError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseDumpError';
  }
}

/** True when the deployment actually speaks PostgreSQL. */
export const isPostgresUrl = (rawUrl: string): boolean => {
  const value = String(rawUrl || '').trim();
  return /^postgres(ql)?:\/\//i.test(value);
};

/** Same test for a `URL` instance, whose `protocol` carries a trailing colon. */
const isPostgresProtocol = (protocol: string): boolean =>
  /^postgres(ql)?:?$/i.test(String(protocol || '').trim());

/**
 * FC-OPS-001 — parses a PostgreSQL URL without depending on a driver, so the
 * dump can run even when the app has no live pool (e.g. during restore).
 */
export const parsePostgresUrl = (rawUrl: string): ParsedDatabaseUrl => {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new DatabaseDumpError('DATABASE_URL is not a valid URL');
  }

  if (!isPostgresProtocol(parsed.protocol)) {
    throw new DatabaseDumpError(`Unsupported database protocol: ${parsed.protocol}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new DatabaseDumpError('DATABASE_URL is missing the database name');
  }

  const hostname = parsed.hostname || 'localhost';

  return {
    host: hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database,
    // ?host=/var/run/postgresql selects a unix socket directory.
    socketDir: parsed.searchParams.get('host') || undefined,
  };
};

const baseEnv = (parsed: ParsedDatabaseUrl) => ({
  ...process.env,
  // libpq reads these; passing them in the environment keeps the password off
  // the command line, where it would be visible in `ps`.
  PGHOST: parsed.socketDir || parsed.host,
  PGPORT: String(parsed.port),
  PGUSER: parsed.user,
  PGDATABASE: parsed.database,
  PGPASSWORD: parsed.password,
  // Deterministic, machine-readable output.
  PGCLIENTENCODING: 'UTF8',
});

const runTool = async (tool: string, args: string[], parsed: ParsedDatabaseUrl, maxBuffer: number): Promise<Buffer> => {
  try {
    const { stdout } = await run(tool, args, {
      env: baseEnv(parsed),
      maxBuffer,
      encoding: 'buffer',
      windowsHide: true,
    });
    return stdout as unknown as Buffer;
  } catch (error: any) {
    throw new DatabaseDumpError(
      `${tool} failed: ${error?.stderr?.toString?.() || error?.message || 'unknown error'}`,
      error,
    );
  }
};

/**
 * The one place `pg_dump` is told what to do.
 *
 * There were two callers that each built their own argument list, and a partial dump is
 * a security-relevant decision — `--table=Item` is the difference between a stock backup
 * and one that also replaces users and roles. Two builders is two chances for that to
 * differ, so the streaming path and the buffered path share this function.
 */
const dumpArgs = (format: PgDumpFormat, tables?: readonly string[]): string[] => {
  const args = [
    '--no-password',
    '--no-owner',
    '--no-privileges',
    // A single consistent snapshot across every table.
    '--serializable-deferrable',
    `--format=${format}`,
  ];
  // A partial dump. This is what makes an "inventory" backup an inventory
  // backup: the previous buildPayload took the same pg_dump branch for full,
  // inventory and safety_snapshot, so an inventory archive was byte-for-byte a
  // whole-database dump, and restoring it with --clean replaced users and roles
  // while the UI called it a stock backup.
  if (tables?.length) {
    for (const table of tables) args.push(`--table=${table}`);
  }
  if (format === 'plain') {
    // Keep the dump reloadable by a plain `psql` too.
    args.push('--inserts', '--clean');
  }
  return args;
};

/**
 * Takes a consistent, restorable dump.
 *
 * `--format=custom` is required: only the custom format can be restored by
 * `pg_restore` with selective object control, which the restore path needs.
 */
export const dumpPostgres = async (
  rawUrl: string,
  options: { format?: PgDumpFormat; tables?: string[] } = {},
): Promise<PgDumpResult> => {
  const parsed = parsePostgresUrl(rawUrl);
  const format = options.format ?? 'custom';

  const args = dumpArgs(format, options.tables);

  const buffer = await runTool('pg_dump', args, parsed, MAX_DUMP_BYTES);
  if (!buffer || buffer.length === 0) {
    throw new DatabaseDumpError('pg_dump produced an empty dump');
  }
  // B15-0 — refuse here, with the numbers, while the dump is still a Buffer.
  //
  // Before this, the ceiling was 512 MiB and the archive is 1.778x the dump, so any
  // dump above ~288 MiB reached `encrypted.toString('base64')` and threw
  // `RangeError: Invalid string length` from inside V8 — after the dump had been
  // taken and roughly six gigabytes had been allocated. The refusal now names the
  // size, the limit and the wall that set it.
  if (buffer.length > MAX_DUMP_BYTES) {
    throw new DatabaseDumpError(dumpTooLargeMessage(buffer.length));
  }

  return { base64: buffer.toString('base64'), format, byteLength: buffer.length };
};

export type StreamResult = { bytes: number; format: PgDumpFormat };

/**
 * A destination for streamed bytes.
 *
 * `write` may return a promise and is awaited, which is how backpressure reaches the
 * child process: the container writer awaits `drain` internally, so a slow disk slows
 * `pg_dump` instead of filling a queue in this process.
 */
export type StreamSink = { write: (chunk: Buffer) => void | Promise<void> };

/**
 * B15-2 — `pg_dump` as a stream.
 *
 * `dumpPostgres` buffers the whole dump because `execFile` has no other mode, and then
 * hands back base64. Six resident copies later that becomes a hard wall at ~288 MiB.
 * Here the dump is never resident: it is pumped into `sink` and the only thing this
 * function returns is how many bytes went past.
 *
 * Three things this has to get right, and each of them was a bug in the buffered form:
 *
 * 1. **The ceiling is enforced while pumping.** `maxBuffer` could only refuse a dump
 *    that was already in memory. Crossing the limit here kills the child rather than
 *    waiting for it to finish producing something that is going to be thrown away.
 * 2. **A failure is a failure.** A non-zero exit rejects with pg_dump's own stderr, so
 *    "the archive is corrupt" is never reported for a dump that never started.
 * 3. **The child is always reaped.** Every exit path awaits `close`, which on Windows
 *    is what actually releases the handle; a killed child left unreaped holds the
 *    stdout pipe open and the promise never settles.
 */
export const streamPostgresDump = async (
  rawUrl: string,
  sink: StreamSink,
  options: { format?: PgDumpFormat; tables?: string[]; maxBytes?: number } = {},
): Promise<StreamResult> => {
  const parsed = parsePostgresUrl(rawUrl);
  const format = options.format ?? 'custom';
  const maxBytes = options.maxBytes ?? MAX_DUMP_BYTES;
  const { spawn } = await import('node:child_process');

  const child = spawn('pg_dump', dumpArgs(format, options.tables), {
    env: baseEnv(parsed),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bytes = 0;
  let stderr = '';
  let failure: Error | null = null;

  const pump = new Promise<void>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (maxBytes && bytes > maxBytes) {
        failure = new DatabaseDumpError(dumpTooLargeMessage(bytes));
        // SIGTERM first: the child is mid-write and deserves the chance to stop. The
        // archive writer discards its temp file on this rejection either way.
        child.kill('SIGTERM');
        return;
      }
      Promise.resolve(sink.write(chunk)).catch((error: any) => {
        failure = failure ?? new DatabaseDumpError(`writing the dump failed: ${error?.message || error}`, error);
        child.kill('SIGTERM');
      });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString();
    });
    child.on('error', (error: any) => {
      failure = failure ?? new DatabaseDumpError(`pg_dump could not start: ${error?.message || error}`, error);
    });
    // `close`, not `exit`: `exit` fires while stdio may still be open, and on Windows
    // the handle is only released at close.
    child.on('close', (code) => {
      if (!failure && code !== 0) {
        failure = new DatabaseDumpError(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`);
      }
      resolve();
    });
  });

  await pump;
  if (failure) throw failure;
  if (bytes === 0) {
    throw new DatabaseDumpError('pg_dump produced an empty dump');
  }
  return { bytes, format };
};

/**
 * The one place `pg_restore` is told what to do.
 *
 * The same reason as `dumpArgs`: `--clean` and `--single-transaction` are not style
 * choices, they decide whether a restore replaces a schema or half of one.
 *
 * `forceSingleTransaction` exists because the streamed path must never be told otherwise
 * — see `restorePostgresFromStream`. It is a parameter rather than a second builder so
 * the two paths cannot drift into disagreeing about whether the restore is atomic.
 */
export const restoreArgs = (
  database: string,
  options: RestoreOptions,
  forceSingleTransaction = false,
): string[] => {
  const args: string[] = ['--no-password', '--no-owner', '--no-privileges'];
  // `clean` drops and recreates the objects it names. Correct for a full dump, wrong for
  // a subset: it is the difference between "restore these tables" and "replace the
  // schema". A partial restore therefore never passes it.
  if (options.clean !== false && !options.tables?.length) args.push('--clean', '--if-exists');
  if (options.exitOnError !== false) args.push('--exit-on-error');
  if (forceSingleTransaction) args.push('--single-transaction');
  else if (options.singleTransaction) args.push('--single-transaction');
  for (const table of options.tables ?? []) args.push(`--table=${table}`);
  args.push('--dbname', database);
  return args;
};

/**
 * B15-2 — restore from a stream.
 *
 * The dump is fed to `pg_restore` chunk by chunk, so restoring a large archive no
 * longer needs the payload, the ciphertext, the plaintext and the tool's input to exist
 * at the same time.
 *
 * `--single-transaction` is not optional here and is forced on regardless of what the
 * caller passed. The stream's integrity tag is only verified when the stream *ends*, so
 * a dump that turns out to be corrupt can fail after `pg_restore` has already applied
 * most of it. In one transaction that failure rolls the whole thing back; without it the
 * database is left half-replaced by the tool that was recovering it — and a
 * half-replaced database is the state nobody notices until it is too late to compare.
 */
export const restorePostgresFromStream = async (
  rawUrl: string,
  source: AsyncIterable<Buffer>,
  options: RestoreOptions = {},
): Promise<{ bytes: number }> => {
  const parsed = parsePostgresUrl(options.targetUrl || rawUrl);
  const { spawn } = await import('node:child_process');

  // Forced, not defaulted. See above.
  const args = restoreArgs(parsed.database, options, true);

  let bytes = 0;
  let stderr = '';
  let failure: Error | null = null;

  await new Promise<void>((resolve) => {
    const child = spawn('pg_restore', args, { env: baseEnv(parsed), windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString();
    });
    child.on('error', (error: any) => {
      failure = failure ?? new DatabaseDumpError(`pg_restore could not start: ${error?.message || error}`, error);
      resolve();
    });
    child.on('close', (code) => {
      if (!failure && code !== 0) {
        failure = new DatabaseDumpError(`pg_restore exited ${code}: ${stderr.slice(0, 500)}`);
      }
      resolve();
    });

    (async () => {
      try {
        for await (const chunk of source) {
          if (child.stdin.destroyed) break;
          bytes += chunk.length;
          if (!child.stdin.write(chunk)) {
            await new Promise((r) => child.stdin.once('drain', r));
          }
        }
      } catch (error: any) {
        // A stream that fails its integrity tag fails here, mid-restore. The transaction
        // is what makes that survivable.
        failure = failure ?? new DatabaseDumpError(`the dump stream failed: ${error?.message || error}`, error);
        child.kill('SIGTERM');
        return;
      } finally {
        child.stdin.end();
      }
    })();
  });

  if (failure) throw failure;
  return { bytes };
};

/**
 * Where and how a restore writes.
 *
 * Declared after the functions above on purpose: `restorePostgresFromStream` documents
 * why it overrides two of these fields, and the reader should meet that reasoning before
 * the type it is reasoning about.
 */
export type RestoreOptions = {
  /**
   * Restores into a target database. Defaults to the configured one, which is
   * destructive; callers must have taken a safety snapshot first.
   */
  targetUrl?: string;
  /** Drops objects before recreating them. */
  clean?: boolean;
  /** Stops at the first error instead of continuing. */
  exitOnError?: boolean;
  /** Single transaction: a failure leaves the database untouched. */
  singleTransaction?: boolean;
  /**
   * Restores only these tables, and without --clean.
   *
   * The pairing matters: a partial dump restored with `clean` drops and
   * recreates the objects it names, which for a table list is a different
   * operation from restoring a database. `clean` is only correct for a full
   * dump, and applying it to a subset is how a stock restore can take identity
   * tables with it.
   */
  tables?: string[];
};

export const restorePostgres = async (
  rawUrl: string,
  dumpBase64: string,
  options: RestoreOptions = {},
): Promise<{ bytes: number }> => {
  const parsed = parsePostgresUrl(options.targetUrl || rawUrl);
  const buffer = Buffer.from(String(dumpBase64 || ''), 'base64');
  if (buffer.length === 0) {
    throw new DatabaseDumpError('Refusing to restore an empty dump');
  }

  const { spawn } = await import('node:child_process');
  const env = baseEnv(parsed);

  // A custom-format archive is replayed by pg_restore, which reads stdin.
  //
  // Checked against `buffer`, which is already decoded. This used to call
  // `isValidCustomDump(dumpBase64)`, which decoded the payload a second time — a
  // full-size copy, allocated to read five bytes, on the path an operator reaches
  // when the database is already broken.
  if (isCustomDumpBuffer(buffer)) {
    const args = restoreArgs(parsed.database, options);

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('pg_restore', args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new DatabaseDumpError(`pg_restore exited ${code}: ${stderr.slice(0, 500)}`));
        });
        child.stdin.on('error', () => { /* surfaced through the close code */ });
        child.stdin.end(buffer);
      });
    } catch (error) {
      if (error instanceof DatabaseDumpError) throw error;
      throw new DatabaseDumpError(`pg_restore failed: ${(error as Error)?.message || 'unknown error'}`, error);
    }

    return { bytes: buffer.length };
  }

  // A plain SQL dump is replayed by psql instead.
  const args: string[] = ['--no-password', '--exit-on-error', '--single-transaction', '--dbname', parsed.database];
  if (options.clean !== false) args.push('--clean', '--if-exists');

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('psql', args, { env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new DatabaseDumpError(`psql exited ${code}: ${stderr.slice(0, 500)}`));
      });
      child.stdin.on('error', () => { /* surfaced through the close code */ });
      child.stdin.end(buffer);
    });
  } catch (error) {
    if (error instanceof DatabaseDumpError) throw error;
    throw new DatabaseDumpError(`psql restore failed: ${(error as Error)?.message || 'unknown error'}`, error);
  }

  return { bytes: buffer.length };
};

/**
 * FC-OPS-001 — the custom-format magic, read from bytes already in hand.
 *
 * Five bytes, and the caller almost always holds the decoded dump. Taking a string
 * here meant the only production caller decoded a payload a second time to use it.
 */
export const isCustomDumpBuffer = (buffer: Buffer | Uint8Array | null | undefined): boolean => {
  if (!buffer || buffer.length < 5) return false;
  return Buffer.from(buffer.buffer, buffer.byteOffset, 5).toString('ascii') === 'PGDMP';
};

/**
 * FC-OPS-001 — verifies the dump is structurally readable before trusting it.
 *
 * Kept as the string form for callers that hold base64 and nothing else; anything
 * that already has the bytes should call `isCustomDumpBuffer`.
 */
export const isValidCustomDump = (base64: string): boolean =>
  isCustomDumpBuffer(Buffer.from(String(base64 || ''), 'base64'));
