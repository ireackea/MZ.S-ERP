import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A throwaway database for a destructive test.
 *
 * The reset is the only feature in this system that deletes the data it runs on,
 * and the success path is the one that was never executed: the order test replays
 * the delete statements inside a transaction it rolls back, which never writes an
 * audit row and never exercises the writer. So the one line of code that broke was
 * on a path that had only been reasoned about, and it failed in front of the
 * owner.
 *
 * Running it against the live database was never an option — that is the owner's
 * 648 items, 1252 movements and 210 recorded deficits. So the test creates its own
 * database, migrates it, seeds the minimum, runs a real reset, and drops it.
 *
 * Nothing here touches the application database. The name is asserted to differ
 * from `DATABASE_URL` before anything is created, so a misconfigured environment
 * cannot point this at real data.
 */

const COMPOSE_FILE = join(process.cwd(), 'docker-compose.yml');
const ADMIN_USER = process.env.POSTGRES_USER || 'feedfactory';
const ADMIN_DB = process.env.POSTGRES_DB || 'feed_factory_db';
export const TEST_DB = 'mzs_reset_sandbox';

const psql = (sql: string, database = ADMIN_DB, onFail: 'throw' | 'return' = 'return'): string => {
  try {
    return execFileSync(
      'docker',
      ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres', 'psql', '-U', ADMIN_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
      { encoding: 'utf8', timeout: 120_000 },
    );
  } catch (error: any) {
    if (onFail === 'throw') throw error;
    return String(error?.stdout ?? '') + String(error?.stderr ?? '');
  }
};

export const createSandbox = (): void => {
  // The guard that makes this safe to run automatically: the sandbox name must
  // not be what the application is already using.
  const configured = applicationDatabaseUrl();
  if (new RegExp(`/${TEST_DB}(\\?|$)`).test(configured)) {
    throw new Error('refusing to run: the application database URL already names the sandbox');
  }

  // Prisma migrate will not create the database, and IF NOT EXISTS makes a
  // leftover from an interrupted run harmless.
  psql(`DROP DATABASE IF EXISTS "${TEST_DB}";`, ADMIN_DB, 'throw');
  psql(`CREATE DATABASE "${TEST_DB}";`, ADMIN_DB, 'throw');
};

/**
 * The Prisma CLI, invoked through the local binary.
 *
 * `npx` is not resolvable from a spawned process in this environment, which is
 * the same reason the permission-matcher agreement test could not shell out to
 * `tsx`. Prisma is also configured through `prisma.config.ts` in this project, so
 * the cwd matters as much as the binary.
 */
const prismaEntry = (): string => {
  const candidates = [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    join(process.cwd(), 'backend', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('could not find the prisma CLI entry point');
  return found;
};

/**
 * Run through `node <entry>` rather than the `.bin` shim.
 *
 * The shims are `.cmd` on Windows, and a spawned `.cmd` needs a shell — which
 * Node refuses with EINVAL unless one is provided, and providing one to a command
 * carrying a database URL is a worse trade than invoking the JS entry directly.
 */
export const migrateSandbox = (): void => {
  execFileSync(
    process.execPath,
    [prismaEntry(), 'migrate', 'deploy', `--schema=${join(process.cwd(), 'backend/prisma/schema.prisma')}`],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: sandboxUrl() },
      encoding: 'utf8',
      timeout: 300_000,
      stdio: 'pipe',
    },
  );
};

/**
 * The application database URL, read from the running container.
 *
 * It is not in this process's environment: the E2E helpers talk to the API over
 * HTTP and never needed it, and putting a credential in the shell to run a test
 * would be a worse habit than reading it from where the app already has it.
 */
let cachedUrl: string | null = null;

/**
 * The full environment the real backend container runs with.
 *
 * The sandbox app is booted from these values rather than from the vitest
 * process, which does not have JWT_SECRET, FRONTEND_URL, or the encryption key.
 * A child missing any of those fails during module construction, and the symptom
 * is only "the sandbox app did not come up" — with the real reason on a stderr
 * stream nobody was reading.
 */
export const applicationEnv = (): Record<string, string> => {
  const container = execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'ps', '-q', 'backend'],
    { encoding: 'utf8', timeout: 60_000 },
  ).trim();
  if (!container) throw new Error('the backend container is not running');

  const out = execFileSync(
    'docker',
    ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container],
    { encoding: 'utf8', timeout: 60_000 },
  );
  const env: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
};

export const applicationDatabaseUrl = (): string => {
  const url = applicationEnv().DATABASE_URL;
  if (!url) throw new Error('the backend container has no DATABASE_URL');
  return url;
};

/**
 * The sandbox URL, rewritten for use from the host.
 *
 * Two things differ from the container's own URL. The host is `localhost` rather
 * than the compose service name `postgres` — that name only resolves inside the
 * network — and the database is the sandbox. The port is discovered from the
 * postgres container rather than assumed, so a project that publishes a different
 * host port still works.
 */
export const sandboxUrl = (): string => {
  const configured = applicationDatabaseUrl();
  if (new RegExp(`/${TEST_DB}(\\?|$)`).test(configured)) {
    throw new Error('refusing to run: the application database URL already names the sandbox');
  }

  // Rewritten by hand. `new URL` normalises the scheme to `http://`, which Prisma
  // refuses with "the scheme is not recognized".
  //
  // Only the host is replaced. An earlier version replaced the whole authority,
  // which silently dropped `user:password@` and produced P1010 "user was denied
  // access" — a credential failure that looks like a permissions problem.
  const match = configured.match(/^(postgres(?:ql)?):\/\/([^@/]*)@(.*)$/);
  if (!match) {
    throw new Error(
      `could not split the database URL: ${configured.replace(/:[^:@/]+@/, ':***@')}`,
    );
  }
  const [, scheme, credentials, rest] = match;

  // Only the query string survives. The path is replaced wholesale: an earlier
  // version kept the original `/feed_factory_db` after the sandbox name, which
  // made Prisma look for a database literally named "mzs_reset_sandbox/feed_factory_db"
  // and report P3014 DatabaseDoesNotExist.
  const queryAt = rest.indexOf('?');
  const query = queryAt >= 0 ? rest.slice(queryAt) : '';

  return `${scheme}://${credentials}@127.0.0.1:${publishedPostgresPort()}/${TEST_DB}${query}`;
};

/** The host port the postgres container publishes, discovered rather than assumed. */
let cachedPort: string | null = null;

const publishedPostgresPort = (): string => {
  if (cachedPort) return cachedPort;
  const out = execFileSync(
    'docker',
    [
      'compose', '-f', COMPOSE_FILE, 'ps', '--format', 'json', 'postgres',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  // `ps --format json` emits one object per line on some versions and an array on
  // others, so both are handled rather than assumed.
  const entries = (() => {
    const text = out.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    }
  })();

  for (const entry of entries) {
    const publishers = Array.isArray(entry?.Publishers) ? entry.Publishers : [];
    for (const publisher of publishers) {
      const port = Number(publisher?.PublishedPort ?? 0);
      if (port > 0) {
        cachedPort = String(port);
        return cachedPort;
      }
    }
  }

  // `compose ps --format json` nests the publisher list differently across
  // compose versions, and parsing its output was the wrong thing to depend on.
  // `compose port` answers the question directly.
  const mapped = execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'port', 'postgres', '5432'],
    { encoding: 'utf8', timeout: 60_000 },
  )
    .trim()
    .split(/\r?\n/)[0];
  const fromPortCommand = Number(mapped.split(':').pop());
  if (fromPortCommand > 0) {
    cachedPort = String(fromPortCommand);
    return cachedPort;
  }

  throw new Error('could not find the published port for the postgres container');
};

export const psqlInSandbox = (sql: string): string => psql(sql, TEST_DB, 'throw');

export const dropSandbox = (): void => {
  // Terminate stragglers first: a pooled connection holding the database open
  // makes DROP fail, and a failed DROP leaves a database the next run must clean.
  psql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid();`,
    ADMIN_DB,
  );
  psql(`DROP DATABASE IF EXISTS "${TEST_DB}";`, ADMIN_DB, 'throw');
};

export const rowCount = (table: string): number => Number(psqlInSandbox(`SELECT count(*) FROM "${table}";`).trim() || 0);

/** The compose file this project is defined in. */
export const composeFile = (): string => COMPOSE_FILE;

const projectName = (): string => {
  const out = execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'ps', '-q', 'postgres'],
    { encoding: 'utf8', timeout: 60_000 },
  ).trim();
  const id = out.split(/\r?\n/)[0] || '';
  const name = execFileSync('docker', ['inspect', '--format', '{{.Name}}', id], {
    encoding: 'utf8',
    timeout: 60_000,
  })
    .trim()
    .replace(/^\//, '');
  const project = execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'ps', '--format', 'json', 'postgres'],
    { encoding: 'utf8', timeout: 60_000 },
  );
  const match = project.match(/"Project":"([^"]+)"/);
  return match ? match[1] : name.replace(/-postgres-\d+$/, '');
};

/**
 * The sandbox URL as seen from inside the compose network, where the service name
 * `postgres` resolves. The host rewrite in `sandboxUrl` is only correct for
 * processes running on the host.
 */
export const sandboxContainerUrl = (): string => {
  const configured = applicationDatabaseUrl();
  if (new RegExp(`/${TEST_DB}(\\?|$)`).test(configured)) {
    throw new Error('refusing to run: the application database URL already names the sandbox');
  }
  return configured.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);
};
