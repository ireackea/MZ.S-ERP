const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS || 8000);
const healthUrls = process.env.HEALTH_URL
  ? [process.env.HEALTH_URL]
  : ['http://localhost:3001/api/health', 'http://localhost/api/health'];

const fetchHealth = async (healthUrl) => {
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

    return {
      ok: true,
      url: healthUrl,
      status: payload.status,
      uptime: payload.uptime,
      dbConnected: payload.dbConnected,
    };
  } finally {
    clearTimeout(timeout);
  }
};

let lastError = null;

for (const healthUrl of healthUrls) {
  try {
    const result = await fetchHealth(healthUrl);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    lastError = {
      ok: false,
      url: healthUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

console.error(JSON.stringify(lastError || {
  ok: false,
  url: healthUrls[0] || '',
  error: 'No health endpoints configured',
}));
process.exitCode = 1;
