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

const run = promisify(execFile);

export type PgDumpFormat = 'custom' | 'plain';

export type PgDumpResult = {
  /** The dump bytes, base64-encoded for transport inside the backup payload. */
  base64: string;
  format: PgDumpFormat;
  byteLength: number;
};

export const MAX_DUMP_BYTES = 512 * 1024 * 1024;

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
  if (options.tables?.length) {
    for (const table of options.tables) args.push(`--table=${table}`);
  }
  if (format === 'plain') {
    // Keep the dump reloadable by a plain `psql` too.
    args.push('--inserts', '--clean');
  }

  const buffer = await runTool('pg_dump', args, parsed, MAX_DUMP_BYTES);
  if (!buffer || buffer.length === 0) {
    throw new DatabaseDumpError('pg_dump produced an empty dump');
  }
  if (buffer.length > MAX_DUMP_BYTES) {
    throw new DatabaseDumpError(`pg_dump output exceeded ${MAX_DUMP_BYTES} bytes`);
  }

  return { base64: buffer.toString('base64'), format, byteLength: buffer.length };
};

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
  const maxBuffer = MAX_DUMP_BYTES;

  // A custom-format archive is replayed by pg_restore, which reads stdin.
  if (isValidCustomDump(dumpBase64)) {
    const args: string[] = ['--no-password', '--no-owner', '--no-privileges'];
    // `clean` drops and recreates the objects it names. Correct for a full dump,
    // wrong for a subset: it is the difference between "restore these tables" and
    // "replace the schema". A partial restore therefore never passes it.
    if (options.clean !== false && !options.tables?.length) args.push('--clean', '--if-exists');
    if (options.exitOnError !== false) args.push('--exit-on-error');
    if (options.singleTransaction) args.push('--single-transaction');
    for (const table of options.tables ?? []) args.push(`--table=${table}`);
    args.push('--dbname', parsed.database);

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

/** FC-OPS-001 — verifies the dump is structurally readable before trusting it. */
export const isValidCustomDump = (base64: string): boolean => {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  return buffer.length > 0 && buffer.subarray(0, 5).toString('ascii') === 'PGDMP';
};
