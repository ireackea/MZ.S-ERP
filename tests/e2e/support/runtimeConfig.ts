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

const readBackendEnvValue = (key: string): string | undefined => {
  const envFilePath = path.resolve(process.cwd(), 'backend', '.env');
  if (!fs.existsSync(envFilePath)) {
    return undefined;
  }

  const envFile = fs.readFileSync(envFilePath, 'utf8');
  const line = envFile
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));

  if (!line) {
    return undefined;
  }

  const rawValue = line.slice(key.length + 1).trim();
  if (!rawValue) {
    return undefined;
  }

  return rawValue.replace(/^['\"]|['\"]$/g, '');
};

export const frontendUrl = readEnvValue('E2E_FRONTEND_URL')
  || readEnvValue('FRONTEND_URL')
  || 'http://localhost:5173';

export const backendUrl = readEnvValue('E2E_BASE_URL') || 'http://localhost:3001';
export const e2eUsername = readEnvValue('E2E_USERNAME') || 'superadmin';
export const e2ePassword = readEnvValue('E2E_PASSWORD') || 'SecurePassword2026!';

export const getMetricsHeaders = (): Record<string, string> => {
  const token = readEnvValue('E2E_METRICS_AUTH_TOKEN')
    || readEnvValue('METRICS_AUTH_TOKEN')
    || readBackendEnvValue('METRICS_AUTH_TOKEN');

  return token ? { 'x-metrics-token': token } : {};
};