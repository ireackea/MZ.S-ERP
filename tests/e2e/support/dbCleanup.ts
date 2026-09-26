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
