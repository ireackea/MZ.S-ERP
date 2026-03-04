const healthUrl = process.env.HEALTH_URL || 'http://localhost/api/health';
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS || 8000);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(healthUrl, {
    method: 'GET',
    signal: controller.signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Health endpoint returned ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || (payload.status !== 'healthy' && payload.status !== 'degraded')) {
    throw new Error('Health payload shape is invalid');
  }

  console.log(
    JSON.stringify({
      ok: true,
      url: healthUrl,
      status: payload.status,
      uptime: payload.uptime,
      dbConnected: payload.dbConnected,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      url: healthUrl,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
