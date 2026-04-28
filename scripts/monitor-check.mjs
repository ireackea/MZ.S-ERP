import fs from 'node:fs';
import path from 'node:path';

const metricsUrls = process.env.METRICS_URL
  ? [String(process.env.METRICS_URL).trim()]
  : ['http://localhost:3001/metrics', 'http://127.0.0.1:3001/metrics'];

const readBackendEnvValue = (key) => {
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
  return rawValue ? rawValue.replace(/^['\"]|['\"]$/g, '') : undefined;
};

const resolveToken = () => {
  const directToken = String(process.env.E2E_METRICS_AUTH_TOKEN || process.env.METRICS_AUTH_TOKEN || '').trim();
  return directToken || readBackendEnvValue('METRICS_AUTH_TOKEN') || '';
};

const metricsToken = resolveToken();
const headers = metricsToken ? { 'x-metrics-token': metricsToken } : {};

let lastError = null;

for (const metricsUrl of metricsUrls.filter(Boolean)) {
  const response = await fetch(metricsUrl, { headers }).catch((error) => {
    lastError = `Metrics endpoint unavailable at ${metricsUrl}: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  });

  if (!response) {
    continue;
  }

  const text = await response.text();

  if (!response.ok) {
    lastError = `Metrics endpoint unavailable at ${metricsUrl} (${response.status})`;
    continue;
  }

  if (!text.includes('http_requests_total')) {
    lastError = `Missing Prometheus request metrics at ${metricsUrl}`;
    continue;
  }

  if (!text.includes('process_uptime_seconds')) {
    lastError = `Missing Prometheus uptime metrics at ${metricsUrl}`;
    continue;
  }

  console.log('monitoring:ok');
  process.exit(0);
}

throw new Error(lastError || 'No metrics endpoints configured');