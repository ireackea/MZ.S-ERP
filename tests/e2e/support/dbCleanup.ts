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
