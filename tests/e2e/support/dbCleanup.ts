import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Test-only cleanup for fixtures the API intentionally does not expose a
 * delete route for (e.g. custom roles). Runs `psql` inside the compose
 * database service and is a no-op when the container is unavailable.
 */
const composeFile = path.resolve(process.cwd(), 'docker-compose.yml');
const service = 'postgres';
const dbUser = process.env.POSTGRES_USER || 'feedfactory';
const dbName = process.env.POSTGRES_DB || 'feed_factory_db';

const hasComposeFile = (): boolean => fs.existsSync(composeFile);

const runSql = (sql: string): boolean => {
  if (!hasComposeFile()) return false;
  try {
    execFileSync(
      'docker',
      ['compose', '-f', composeFile, 'exec', '-T', service, 'psql', '-U', dbUser, '-d', dbName, '-c', sql],
      { stdio: 'ignore', timeout: 20_000 },
    );
    return true;
  } catch {
    return false;
  }
};

/** Single scalar, or null when the statement fails. */
const sqlScalar = (sql: string): number | null => {
  if (!hasComposeFile()) return null;
  try {
    const out = execFileSync(
      'docker',
      ['compose', '-f', composeFile, 'exec', '-T', service, 'psql', '-U', dbUser, '-d', dbName, '-At', '-c', sql],
      { encoding: 'utf8', timeout: 20_000 },
    );
    const value = Number(String(out).trim().split(/\r?\n/).pop());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

export const cleanupRole = (roleId: string): boolean => {
  if (!roleId) return false;
  return runSql(`DELETE FROM roles WHERE id = '${roleId.replace(/'/g, "''")}'`);
};

/** A role is only removable once nothing references it, so clear the link first. */
export const cleanupRoleAndUsers = (roleId: string): boolean => {
  if (!roleId) return false;
  const safe = roleId.replace(/'/g, "''");
  return runSql(
    `DELETE FROM users WHERE "roleId" = '${safe}'; DELETE FROM roles WHERE id = '${safe}';`,
  );
};

export const cleanupUser = (userId: string): boolean => {
  if (!userId) return false;
  return runSql(`DELETE FROM users WHERE id = '${userId.replace(/'/g, "''")}'`);
};

export const cleanupUsersByPrefix = (prefix: string): boolean => {
  if (!prefix) return false;
  return runSql(
    `DELETE FROM invitations WHERE email LIKE '${prefix.replace(/'/g, "''")}%';`
    + `DELETE FROM users WHERE username LIKE '${prefix.replace(/'/g, "''")}%';`,
  );
};

/**
 * Removes roles that match a test naming pattern and hold no users. The E2E
 * suite used to leave `Phase3RestrictedRole_*` behind with no cleanup path,
 * because the API has no role delete route; 14 of them were sitting in the
 * production roles table.
 */
export const cleanupOrphanRolesByPattern = (pattern: string): boolean => {
  if (!pattern) return false;
  const safe = pattern.replace(/'/g, "''");
  return runSql(
    `DELETE FROM roles r WHERE r.name LIKE '${safe}'`
    + ` AND NOT EXISTS (SELECT 1 FROM users u WHERE u."roleId" = r.id);`,
  );
};

/**
 * Backdates an invitation so it can be observed in the expired state without
 * waiting out a real expiry.
 *
 * This is the only way to reach that state: the API rejects an expired
 * invitation at verify and at accept, and nothing ever moves the stored
 * `status` column. So "expired" exists solely as a derived value, and a test
 * that cannot produce an expired row proves nothing about it. The stored status
 * is left exactly as the application wrote it, so the assertion can also check
 * that the two disagree.
 */
export const backdateInvitation = (invitationId: string, isoDate: string): boolean => {
  if (!invitationId || !isoDate) return false;
  return runSql(
    `UPDATE invitations SET "expiresAt" = '${isoDate.replace(/'/g, "''")}' WHERE id = '${invitationId.replace(/'/g, "''")}';`,
  );
};

/** Reads the stored columns back, so a test can assert on what the app wrote. */
export const readInvitationRow = (invitationId: string): { status: string; expiresAt: string } | null => {
  if (!invitationId) return null;
  const sql = `SELECT status, "expiresAt" FROM invitations WHERE id = '${invitationId.replace(/'/g, "''")}';`;
  try {
    const out = execFileSync(
      'docker',
      ['compose', '-f', composeFile, 'exec', '-T', service, 'psql', '-U', dbUser, '-d', dbName, '-At', '-F', '|', '-c', sql],
      { encoding: 'utf8', timeout: 20_000 },
    );
    const line = String(out).trim().split(/\r?\n/).find((entry) => entry.includes('|'));
    if (!line) return null;
    const [status, expiresAt] = line.split('|');
    return { status: String(status || ''), expiresAt: String(expiresAt || '') };
  } catch {
    return null;
  }
};

/**
 * Clears many fixtures in one round trip.
 *
 * The per-id helpers above each shell out to `docker compose exec psql`, so a
 * suite that creates twenty users spent more time on teardown than on
 * assertions and blew vitest's 10s `afterAll` timeout. The tests reported one
 * failure that was neither an assertion nor a defect — the run was green and the
 * cleanup was slow, which is the hardest kind of signal to read.
 *
 * One exec, one statement per table, and roles after users so the `roleId`
 * foreign key is never the reason a row survives.
 */
export const cleanupFixtures = (userIds: string[] = [], roleIds: string[] = []): boolean => {
  const ids = (values: string[]) =>
    values.filter(Boolean).map((value) => `'${value.replace(/'/g, "''")}'`).join(',');
  const users = ids(userIds);
  const roles = ids(roleIds);
  if (!users && !roles) return false;

  const statements: string[] = [];
  if (users) {
    // Nothing actually blocks deleting a user: every table that points at one
    // either cascades (active_sessions, idempotency_records) or nulls the
    // reference (audit_logs, orders, partners, OpeningBalance). Invitations are
    // cleared only so the tests' own fixtures do not linger.
    //
    // There is deliberately no statement about StockDeficit here. An earlier
    // version had one, joined wrongly, and referenced a column that does not
    // exist on "Item" — a single bad statement aborts the whole implicit
    // transaction, so every fixture survived while the suite reported itself
    // clean. The leftovers accumulate invisibly, which is worse than a loud
    // failure.
    statements.push(`DELETE FROM invitations WHERE "recipientUserId" IN (${users});`);
    statements.push(`DELETE FROM users WHERE id IN (${users});`);
  }
  if (roles) {
    statements.push(`DELETE FROM roles WHERE id IN (${roles}) AND NOT EXISTS (SELECT 1 FROM users u WHERE u."roleId" = roles.id);`);
  }

  const ok = runSql(statements.join(' '));
  if (!ok) return false;

  // Verify rather than trust. A cleanup helper that silently does nothing is how
  // a database accumulates roles nobody can account for.
  const remaining = sqlScalar(
    `SELECT count(*) FROM users WHERE id IN (${users || "''"})`
    + (roles ? ` + (SELECT count(*) FROM roles WHERE id IN (${roles}))` : '')
    + ';',
  );
  if (remaining !== 0) {
    // Surfaced rather than thrown: a teardown failure must not mask the real
    // assertion result, but it must not be invisible either.
    console.warn(`[dbCleanup] ${remaining} fixture(s) survived teardown — a delete statement failed.`);
    return false;
  }
  return true;
};
