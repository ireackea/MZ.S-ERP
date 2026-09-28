import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  composeFile,
  sandboxContainerUrl,
  createSandbox,
  dropSandbox,
  migrateSandbox,
  psqlInSandbox,
  sandboxUrl,
} from './support/sandboxDb';

const SANDBOX_CONTAINER = 'mzs-reset-sandbox-app';

/**
 * FC-AUD-002 — the reset's success path, executed.
 *
 * This is the test whose absence put a broken line in front of the owner. The
 * delete order had been verified by replaying the statements inside a transaction
 * that rolls back, which never writes an audit row. So the audit write added in
 * Gate 2.4 — and marked TESTED — had never run. It used `actorId` and `message`,
 * which are the column names rather than the Prisma field names, and put an object
 * into a String column. It compiled because the data object was cast `as any`, and
 * it failed at runtime mid-reset with "Unknown argument `actorId`"; only the first
 * bad name is reported, so that line hid two more.
 *
 * ## Why a separate application process
 *
 * The reset deletes the data it runs on. The running API is connected to the
 * owner's database, so sending it a reset request would destroy their 648 items,
 * 1252 movements and 210 recorded deficits. The first draft of this spec posted to
 * the live API and would have done exactly that.
 *
 * So this boots its own instance of the same build against a database it creates,
 * migrates, seeds and drops. Nothing here can reach the application database:
 * `sandboxDb` refuses to start if `DATABASE_URL` already names the sandbox, the
 * child process is given the sandbox URL explicitly, and the teardown drops the
 * database.
 */
const SANDBOX_PORT = 3199;
const SANDBOX_URL = `http://127.0.0.1:${SANDBOX_PORT}/api`;
const ADMIN_USERNAME = 'sandbox_admin';
const ADMIN_PASSWORD = 'SandboxAdmin2026!';

let child: ChildProcess | null = null;
let adminCookie = '';

const psqlLive = (sql: string): string => {
  const compose = join(process.cwd(), 'docker-compose.yml');
  return require('node:child_process').execFileSync(
    'docker',
    ['compose', '-f', compose, 'exec', '-T', 'postgres', 'psql', '-U',
      process.env.POSTGRES_USER || 'feedfactory', '-d', process.env.POSTGRES_DB || 'feed_factory_db',
      '-At', '-c', sql],
    { encoding: 'utf8', timeout: 60_000 },
  );
};

describe('FC-AUD-002 the reset completes, and the record it leaves is real', () => {
  beforeAll(async () => {
    createSandbox();
    migrateSandbox();

    // A SuperAdmin whose password is known, because the reset requires
    // re-authentication and the sandbox's own hash is what we set here.
    const hash = require('node:child_process')
      .execFileSync('node', ['-e', `process.stdout.write(require('bcryptjs').hashSync(${JSON.stringify(ADMIN_PASSWORD)}, 10))`], {
        encoding: 'utf8',
        cwd: join(process.cwd(), 'backend'),
        timeout: 60_000,
      })
      .trim();

    // Seed: an item, a movement, a balance, a rule, and a deficit. The last two
    // are RESTRICT on Item, which is why the original delete order could not work.
    //
    // Ids follow the schema: Item and Transaction are keyed by an autoincrementing
    // Int, StockDeficit needs a publicId and a warehouseId, and Transaction carries
    // a dozen required columns. An earlier draft seeded UUIDs into the integer
    // keys, which Postgres refused with "invalid input syntax for type integer".
    psqlInSandbox(`
      INSERT INTO roles (id, name, description, color, permissions, "createdAt", "updatedAt")
      VALUES ('00000000-0000-4000-8000-000000000001', 'SuperAdmin', 'sandbox', '#000000', '["*"]', now(), now());
      INSERT INTO users (id, username, email, "passwordHash", "isActive", "isEmailConfirmed",
                         "roleId", "createdAt", "updatedAt")
      VALUES ('00000000-0000-4000-8000-00000000000a', '${ADMIN_USERNAME}', 'sandbox@local.test',
              '${hash}', true, true, '00000000-0000-4000-8000-000000000001', now(), now());

      INSERT INTO "Item" (id, name, code, category, "isArchived", "createdAt", "updatedAt")
      VALUES (1, 'صنف', 'SBX-1', 'عام', false, now(), now());

      INSERT INTO unloading_rules (id, "ruleName", "allowedDurationMinutes", "penaltyRatePerMinute",
                                   "isActive", "createdAt", "updatedAt")
      VALUES (1, 'قاعدة', 30, 0, true, now(), now());

      INSERT INTO "StockDeficit" (id, "publicId", "itemId", "warehouseId", quantity, reason, "createdAt", "updatedAt")
      VALUES (1, 'SBX-DEF-1', 1, 'SBX-WH', 5, 'sandbox', now(), now());

      INSERT INTO "OpeningBalance" (id, "itemId", "financialYear", quantity, "unitCost", "createdAt", "updatedAt")
      VALUES (1, 1, 2026, 7, 1, now(), now());

      -- The not-null columns without a default, read from information_schema
      -- rather than guessed: an earlier draft omitted supplierOrReceiver and the
      -- seed failed on a constraint rather than on anything to do with the reset.
      INSERT INTO "Transaction" (id, "publicId", date, "itemId", "warehouseId", type, quantity,
                                 "supplierOrReceiver", "createdAt", "updatedAt")
      VALUES (1, 'SBX-TR-1', now(), 1, 'SBX-WH', 'OUT', 3, 'SBX-SUP', now(), now());
    `);

    // The app runs in a container, not as a host process.
    //
    // It has to. The reset refuses to run unless it can take a backup, and the
    // backup is `pg_dump`, which is not installed on the Windows host — so a
    // host process fails every successful reset with SYSTEM_RESET_BACKUP_FAILED
    // and 503. The system is right about the missing tool; the test would be
    // failing for a reason unrelated to the code under test.
    //
    // `compose run` rather than `docker run`, because the service's environment
    // carries JWT_SECRET and the app refuses to boot without it. Overriding
    // DATABASE_URL and BACKUP_DIR is the whole point: the app must not be able to
    // reach the real database or the real backup volume.
    child = spawn(
      'docker',
      [
        'compose', '-f', composeFile(),
        'run', '--rm', '-d', '--name', SANDBOX_CONTAINER,
        '-p', `${SANDBOX_PORT}:3000`,
        '-e', 'PORT=3000',
        '-e', `DATABASE_URL=${sandboxContainerUrl()}`,
        '-e', 'BACKUP_DIR=/tmp/sandbox-backups',
        '-e', 'NODE_ENV=test',
        'backend',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      if (/error|Error/i.test(text) && process.env.DEBUG_SANDBOX) {
        process.stderr.write(text);
      }
    });

    await waitForHealth();
    adminCookie = await login();
  }, 420_000);

  afterAll(async () => {
    // SIGTERM does not reach a container through the run client, so it is removed
    // by name. If a previous run left one behind, remove that first.
    try {
      execFileSync('docker', ['rm', '-f', SANDBOX_CONTAINER], { stdio: 'ignore' });
    } catch {
      // Nothing to remove.
    }
    child = null;
    try {
      dropSandbox();
    } catch {
      // A sandbox that survives is dropped by DROP IF EXISTS on the next run.
    }
  });

  async function waitForHealth(): Promise<void> {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (Date.now() > deadline) {
        // The reason the app refused to boot was on a container log nobody was
        // reading, so every failure looked identical. It is in the message now.
        let log = '';
        try {
          log = execFileSync('docker', ['logs', '--tail', '20', SANDBOX_CONTAINER], {
            encoding: 'utf8',
            timeout: 60_000,
          });
        } catch {
          log = '(the container produced no log)';
        }
        throw new Error(
          `the sandbox app did not come up on ${SANDBOX_PORT}:\n${log.slice(-1200)}`,
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${SANDBOX_PORT}/api/health`);
        if (response.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function login(): Promise<string> {
    const response = await fetch(`${SANDBOX_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    });
    const cookie = String(response.headers.get('set-cookie') || '');
    if (response.status !== 201) {
      throw new Error(`sandbox login failed: ${response.status} ${await response.text()}`);
    }
    return cookie.split(';')[0];
  }

  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${SANDBOX_URL}${path}`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep the raw text */
    }
    return { status: response.status, body: parsed };
  };

  it('refuses a destructive scope without a backup', async () => {
    const challenge = await post('/admin/reset-system/challenge', { scope: 'data' });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(201);

    const refused = await post('/admin/reset-system', {
      confirmationCode: ADMIN_PASSWORD,
      challengeId: challenge.body.challengeId,
      challengeCode: challenge.body.challengeCode,
      scope: 'data',
      reason: 'sandbox: must be refused without a backup',
      createBackup: false,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('SYSTEM_RESET_BACKUP_REQUIRED');
  }, 180_000);

  it('completes, clears what it claimed, keeps what it claimed, and records itself', async () => {
    // The seed must be real, so a pass cannot come from an empty database.
    expect(psqlInSandbox('SELECT count(*) FROM "Item";').trim()).toBe('1');
    expect(psqlInSandbox('SELECT count(*) FROM "StockDeficit";').trim()).toBe('1');
    // Not an absolute count: booting the app seeds its own administrator, so the
    // sandbox legitimately holds two users. What matters is that the seeded one
    // exists, and the earlier count of exactly 1 was the test being wrong about
    // the world rather than the reset being wrong.
    expect(
      psqlInSandbox(`SELECT count(*) FROM users WHERE username = '${ADMIN_USERNAME}';`).trim(),
    ).toBe('1');

    const challenge = await post('/admin/reset-system/challenge', { scope: 'data' });
    expect(challenge.status).toBe(201);

    // The line that was never executed before this spec existed.
    const done = await post('/admin/reset-system', {
      confirmationCode: ADMIN_PASSWORD,
      challengeId: challenge.body.challengeId,
      challengeCode: challenge.body.challengeCode,
      scope: 'data',
      reason: 'sandbox run of the success path',
      createBackup: true,
    });

    expect(
      done.status,
      `the reset must succeed rather than 500: ${JSON.stringify(done.body).slice(0, 500)}`,
    ).toBe(201);
    expect(done.body.success).toBe(true);
    expect(done.body.scope).toBe('data');

    // Cleared, with numbers rather than a list of names.
    for (const table of ['Item', 'Transaction', 'OpeningBalance', 'StockDeficit', 'unloading_rules']) {
      expect(psqlInSandbox(`SELECT count(*) FROM "${table}";`).trim(), table).toBe('0');
    }
    // `data` does not touch identity, so the seeded account is still there.
    expect(
      psqlInSandbox(`SELECT count(*) FROM users WHERE username = '${ADMIN_USERNAME}';`).trim(),
    ).toBe('1');

    const report = done.body.tablesAffected as Array<{ table: string; rowsDeleted: number }>;
    expect(Array.isArray(report)).toBe(true);
    for (const entry of report) {
      expect(typeof entry.rowsDeleted, `row count for ${entry.table}`).toBe('number');
    }
    expect(report.find((entry) => entry.table === 'Item')?.rowsDeleted).toBe(1);

    // The record survived the audit clear, and carries the actor the generic audit
    // path used to leave NULL.
    const record = psqlInSandbox(
      'SELECT status || \'|\' || "actorId" || \'|\' || "entityId" || \'|\' || coalesce("targetResource", \'\') '
      + 'FROM audit_logs WHERE action = \'SYSTEM_RESET_SUCCESS\' LIMIT 1;',
    ).trim();
    expect(record, 'the reset must leave a record of itself').toBeTruthy();
    const [status, actorId, entityId, targetResource] = record.split('|');
    expect(status).toBe('SUCCESS');
    expect(entityId).toBe('data');
    expect(targetResource).toBe('system_reset');
    expect(actorId, 'the actor column must be populated, not NULL').toBe('00000000-0000-4000-8000-00000000000a');

    // And the metadata is text, not an object that happened to survive.
    const metadata = psqlInSandbox(
      "SELECT metadata FROM audit_logs WHERE action = 'SYSTEM_RESET_SUCCESS' LIMIT 1;",
    ).trim();
    expect(() => JSON.parse(metadata)).not.toThrow();
    expect(JSON.parse(metadata).scope).toBe('data');
  }, 240_000);
});
