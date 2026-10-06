import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const readEnvValue = (key: string): string | undefined => {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Reads a key from an env file, returning the first match.
 *
 * Two locations, in the order the runtime actually resolves them. Docker Compose
 * loads the project-root `.env` automatically for variable *interpolation* and then
 * passes the result into the container, so that file is the live source for anything
 * `docker-compose.yml` interpolates — which is most of them, including
 * `BACKUP_RESTORE_PIN`. `backend/.env` is read second as a fallback for keys that only
 * the backend process sets for itself.
 *
 * Root-first is not a preference. Reading only `backend/.env` finds a file that does
 * exist, so the failure is silent: the helper returns `undefined` for a credential
 * that is definitely configured, and the spec that needed it reports a 401 about the
 * wrong thing entirely.
 */
const readEnvFileValue = (key: string): string | undefined => {
  for (const relativePath of ['.env', 'backend/.env']) {
    const envFilePath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(envFilePath)) {
      continue;
    }

    const line = fs
      .readFileSync(envFilePath, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${key}=`));

    if (!line) {
      continue;
    }

    const rawValue = line.slice(key.length + 1).trim();
    if (rawValue) {
      return rawValue.replace(/^['"]|['"]$/g, '');
    }
  }

  return undefined;
};

export const frontendUrl = readEnvValue('E2E_FRONTEND_URL')
  || readEnvValue('FRONTEND_URL')
  || 'http://localhost:5173';

export const backendUrl = readEnvValue('E2E_BASE_URL') || 'http://localhost:8080';
export const e2eUsername = readEnvValue('E2E_USERNAME') || 'superadmin';
export const e2ePassword = readEnvValue('E2E_PASSWORD') || 'SecurePassword2026!';

export const getMetricsHeaders = (): Record<string, string> => {
  const token = readEnvValue('E2E_METRICS_AUTH_TOKEN')
    || readEnvValue('METRICS_AUTH_TOKEN')
    || readEnvFileValue('METRICS_AUTH_TOKEN');

  return token ? { 'x-metrics-token': token } : {};
};

/**
 * The restore PIN, read the way the server reads it.
 *
 * `verifyRestorePinOrThrow` prefers a hash in `schedule.json` and falls back to
 * `BACKUP_RESTORE_PIN` in the environment. This deployment has no hash, so the env var
 * is the live path. Exposed here rather than read inside each spec because two callers
 * need it and a hard-coded literal produces a test that fails for a reason unrelated
 * to what it is testing.
 *
 * The value is never logged — only sent. A test that prints a PIN teaches everyone
 * reading its output where the credential is.
 */
export const backupRestorePin = (): string | undefined => (
  readEnvValue('BACKUP_RESTORE_PIN') || readEnvFileValue('BACKUP_RESTORE_PIN')
);
