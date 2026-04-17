import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  ensureDir,
  loadAuditConfig,
  makeFinding,
  sortFindings,
  writeJson,
} from './shared.mjs';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith('--') ? next : true;
    if (args[key] !== true) index += 1;
  }
  return args;
}

function createCheck(name, ok, details = {}) {
  return { name, ok, ...details };
}

async function fetchWithBody(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    bodyText,
  };
}

async function waitForHealth(baseUrl, healthPath, timeoutMs = 150000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const probe = await fetchWithBody(new URL(healthPath, baseUrl), { method: 'GET' });
      if (probe.ok) {
        return probe;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for ${healthPath} on ${baseUrl}`);
}

function parseSetCookieHeader(headers) {
  const raw = headers['set-cookie'];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0] : raw;
}

async function loadSocketClient(projectRoot) {
  const resolved = require.resolve('socket.io-client', {
    paths: [
      projectRoot,
      path.join(projectRoot, 'frontend'),
      path.join(projectRoot, 'frontend/node_modules'),
    ],
  });
  return import(resolved);
}

async function trySocketConnection({ projectRoot, baseUrl, namespace, socketPath, origin }) {
  const { io } = await loadSocketClient(projectRoot);
  return await new Promise((resolve) => {
    const client = io(`${baseUrl}${namespace}`, {
      autoConnect: true,
      withCredentials: true,
      path: socketPath,
      transports: ['websocket'],
      extraHeaders: {
        Origin: origin,
      },
      timeout: 7000,
      reconnection: false,
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        client.removeAllListeners();
        client.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    client.on('connect', () => finish({ connected: true }));
    client.on('connect_error', (error) => finish({ connected: false, error: String(error?.message || error) }));
    setTimeout(() => finish({ connected: false, error: 'timeout' }), 9000);
  });
}

export async function runRuntimeAudit({
  projectRoot,
  configPath,
  outputDir,
  backendBaseUrl,
  allowedOrigin,
  metricsToken,
  authUsername,
  authPassword,
}) {
  ensureDir(outputDir);
  const config = loadAuditConfig(configPath);
  const findings = [];
  const checks = [];

  const healthProbe = await waitForHealth(backendBaseUrl, config.runtime.healthPath);
  let healthPayload = {};
  try {
    healthPayload = JSON.parse(healthProbe.bodyText || '{}');
  } catch {
    healthPayload = {};
  }
  const healthOk = healthProbe.ok && ['healthy', 'degraded'].includes(String(healthPayload.status || ''));
  checks.push(createCheck('health-endpoint', healthOk, {
    status: healthProbe.status,
    payloadStatus: healthPayload.status || null,
  }));
  if (!healthOk) {
    findings.push(makeFinding({
      severity: 'critical',
      category: 'runtime',
      ruleId: 'runtime-health-failed',
      title: 'Runtime health probe did not return a healthy/degraded payload',
      description: 'The temporary backend environment did not expose a valid health payload.',
      evidence: `status=${healthProbe.status}`,
      remediation: 'Inspect the temporary docker environment before trusting runtime audit results.',
    }));
  }

  const metricsUnauthorized = await fetchWithBody(new URL(config.runtime.metricsPath, backendBaseUrl), { method: 'GET' });
  const unauthorizedOk = metricsUnauthorized.status === 401;
  checks.push(createCheck('metrics-auth-without-token', unauthorizedOk, { status: metricsUnauthorized.status }));
  if (!unauthorizedOk) {
    findings.push(makeFinding({
      severity: 'high',
      category: 'runtime',
      ruleId: 'metrics-open-without-token',
      title: 'Metrics endpoint was reachable without the audit token',
      description: 'The metrics endpoint should reject anonymous access in the production-like audit environment.',
      evidence: `status=${metricsUnauthorized.status}`,
      remediation: 'Require a token or a stronger internal-only network restriction for /metrics.',
    }));
  }

  const metricsAuthorized = await fetchWithBody(new URL(config.runtime.metricsPath, backendBaseUrl), {
    method: 'GET',
    headers: {
      'x-metrics-token': metricsToken,
    },
  });
  checks.push(createCheck('metrics-auth-with-token', metricsAuthorized.ok && metricsAuthorized.bodyText.includes('http_requests_total'), {
    status: metricsAuthorized.status,
  }));

  const allowedOriginResponse = await fetchWithBody(new URL(config.runtime.healthPath, backendBaseUrl), {
    method: 'GET',
    headers: {
      Origin: allowedOrigin,
    },
  });
  const allowedOriginOk = String(allowedOriginResponse.headers['access-control-allow-origin'] || '') === allowedOrigin;
  checks.push(createCheck('cors-allowed-origin', allowedOriginOk, {
    header: allowedOriginResponse.headers['access-control-allow-origin'] || '',
  }));

  const deniedOriginResponse = await fetchWithBody(new URL(config.runtime.healthPath, backendBaseUrl), {
    method: 'GET',
    headers: {
      Origin: 'https://evil.example',
    },
  });
  const deniedOriginOk = !('access-control-allow-origin' in deniedOriginResponse.headers);
  checks.push(createCheck('cors-denied-origin', deniedOriginOk, {
    header: deniedOriginResponse.headers['access-control-allow-origin'] || '',
    status: deniedOriginResponse.status,
  }));
  if (!deniedOriginOk) {
    findings.push(makeFinding({
      severity: 'high',
      category: 'runtime',
      ruleId: 'cors-disallowed-origin-accepted',
      title: 'Disallowed origin still received CORS approval',
      description: 'The runtime probe observed Access-Control-Allow-Origin for an explicitly untrusted origin.',
      evidence: deniedOriginResponse.headers['access-control-allow-origin'] || '',
      remediation: 'Tighten the CORS allowlist and validate origin handling for both HTTP and websocket traffic.',
    }));
  }

  const protectedProbe = await fetchWithBody(new URL(config.runtime.protectedPaths[0], backendBaseUrl), { method: 'GET' });
  const protectedOk = [401, 403].includes(protectedProbe.status);
  checks.push(createCheck('protected-endpoint-without-session', protectedOk, { status: protectedProbe.status }));
  if (!protectedOk) {
    findings.push(makeFinding({
      severity: 'critical',
      category: 'runtime',
      ruleId: 'protected-endpoint-open',
      title: 'Protected endpoint accepted an anonymous request',
      description: 'A protected API route should reject requests without a valid session.',
      evidence: `path=${config.runtime.protectedPaths[0]}; status=${protectedProbe.status}`,
      remediation: 'Review guards and session enforcement on the probed route.',
    }));
  }

  const loginResponse = await fetchWithBody(new URL(config.runtime.loginPath, backendBaseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
    },
    body: JSON.stringify({
      username: authUsername,
      password: authPassword,
    }),
  });
  const authCookie = parseSetCookieHeader(loginResponse.headers);
  const cookieOk = Boolean(authCookie) && /feed_factory_jwt=/i.test(authCookie) && /HttpOnly/i.test(authCookie) && /SameSite=Strict/i.test(authCookie);
  checks.push(createCheck('auth-cookie-flags', cookieOk, {
    status: loginResponse.status,
    cookie: authCookie,
  }));
  if (!cookieOk) {
    findings.push(makeFinding({
      severity: 'high',
      category: 'runtime',
      ruleId: 'auth-cookie-flags-missing',
      title: 'Auth login response missed strict cookie protections',
      description: 'The runtime login response did not expose the expected auth cookie attributes.',
      evidence: authCookie || `status=${loginResponse.status}`,
      remediation: 'Ensure the login endpoint always sets the auth cookie with HttpOnly and SameSite=Strict.',
    }));
  }

  const socketAnonymousAllowed = await trySocketConnection({
    projectRoot,
    baseUrl: backendBaseUrl,
    namespace: config.runtime.socketNamespace,
    socketPath: config.runtime.socketPath,
    origin: allowedOrigin,
  });
  const anonymousSocketOk = !socketAnonymousAllowed.connected;
  checks.push(createCheck('socket-rejects-anonymous-connection', anonymousSocketOk, socketAnonymousAllowed));
  if (!anonymousSocketOk) {
    findings.push(makeFinding({
      severity: 'critical',
      category: 'runtime',
      ruleId: 'socket-anonymous-connect',
      title: 'Socket.IO namespace accepted an anonymous connection',
      description: 'The runtime websocket probe connected successfully without presenting credentials.',
      evidence: `${config.runtime.socketNamespace} via ${config.runtime.socketPath}`,
      remediation: 'Authenticate the Socket.IO handshake before accepting realtime clients.',
    }));
  }

  const socketEvilOrigin = await trySocketConnection({
    projectRoot,
    baseUrl: backendBaseUrl,
    namespace: config.runtime.socketNamespace,
    socketPath: config.runtime.socketPath,
    origin: 'https://evil.example',
  });
  const socketOriginOk = !socketEvilOrigin.connected;
  checks.push(createCheck('socket-rejects-disallowed-origin', socketOriginOk, socketEvilOrigin));
  if (!socketOriginOk) {
    findings.push(makeFinding({
      severity: 'high',
      category: 'runtime',
      ruleId: 'socket-disallowed-origin-connect',
      title: 'Socket.IO namespace accepted a disallowed origin',
      description: 'The runtime websocket probe connected from an explicitly untrusted Origin header.',
      evidence: 'Origin=https://evil.example',
      remediation: 'Apply the same allowlist enforcement to websocket origins that HTTP already uses.',
    }));
  }

  const report = {
    stage: 'runtime',
    generatedAt: new Date().toISOString(),
    backendBaseUrl,
    allowedOrigin,
    checks,
    findings: sortFindings(findings),
  };

  writeJson(path.join(outputDir, 'runtime-report.json'), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(String(args['project-root'] || process.cwd()));
  const configPath = path.resolve(String(args.config || path.join(projectRoot, 'scripts/audit/audit.config.json')));
  const outputDir = path.resolve(String(args['output-dir'] || path.join(projectRoot, 'audit-reports/surgical/manual')));
  const report = await runRuntimeAudit({
    projectRoot,
    configPath,
    outputDir,
    backendBaseUrl: String(args['backend-base-url']),
    allowedOrigin: String(args['allowed-origin']),
    metricsToken: String(args['metrics-token']),
    authUsername: String(args['auth-username']),
    authPassword: String(args['auth-password']),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
