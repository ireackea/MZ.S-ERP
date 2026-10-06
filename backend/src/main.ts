// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import * as path from 'path';
import * as fs from 'fs';
import { json, urlencoded } from 'express';
import { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit/audit.service';
import { extractClientIp, globalRateLimiter } from './security/global-rate-limit';

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02

function loadBackendEnv() {
  const candidates = [
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .forEach((line) => {
          const idx = line.indexOf('=');
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && process.env[key] === undefined) {
            process.env[key] = value;
          }
        });
      return envPath;
    }
  }
  return null;
}

function getAllowedOrigins() {
  const rawOrigins =
    process.env.CORS_ORIGINS ||
    'http://localhost:4173,http://localhost:5173,http://localhost:5174,http://localhost:3000';
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function isGithubCodespacesOrigin(origin: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.(app|preview)\.github\.dev$/i.test(origin);
}

function matchesConfiguredOrigin(origin: string, allowedOrigins: string[]): boolean {
  const normalizedOrigin = normalizeOrigin(origin);

  return allowedOrigins.some((candidate) => {
    const normalizedCandidate = normalizeOrigin(candidate);
    if (normalizedCandidate.startsWith('*.')) {
      const suffix = normalizedCandidate.slice(1);
      return normalizedOrigin.endsWith(suffix);
    }
    return normalizedCandidate === normalizedOrigin;
  });
}

function isTrustedLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function normalizeRequestPath(req: Request): string {
  return req.path || req.url.split('?')[0] || '/';
}

function requireJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
}

type MetricsRegistry = {
  startedAtMs: number;
  requestsTotal: number;
  requestDurationMsTotal: number;
  statusCounts: Map<string, number>;
  routeCounts: Map<string, number>;
};

function incrementCounter(bucket: Map<string, number>, key: string) {
  bucket.set(key, (bucket.get(key) || 0) + 1);
}

function escapePrometheusLabel(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function renderMetrics(metrics: MetricsRegistry): string {
  const memoryUsage = process.memoryUsage();
  const lines = [
    '# HELP process_uptime_seconds Node.js process uptime in seconds.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${process.uptime()}`,
    '# HELP process_start_time_seconds Node.js process start time since unix epoch in seconds.',
    '# TYPE process_start_time_seconds gauge',
    `process_start_time_seconds ${Math.floor(metrics.startedAtMs / 1000)}`,
    '# HELP nodejs_heap_used_bytes Used heap size in bytes.',
    '# TYPE nodejs_heap_used_bytes gauge',
    `nodejs_heap_used_bytes ${memoryUsage.heapUsed}`,
    '# HELP nodejs_heap_total_bytes Total heap size in bytes.',
    '# TYPE nodejs_heap_total_bytes gauge',
    `nodejs_heap_total_bytes ${memoryUsage.heapTotal}`,
    '# HELP nodejs_rss_bytes Resident set size in bytes.',
    '# TYPE nodejs_rss_bytes gauge',
    `nodejs_rss_bytes ${memoryUsage.rss}`,
    '# HELP http_requests_total Total HTTP requests handled by the backend.',
    '# TYPE http_requests_total counter',
    `http_requests_total ${metrics.requestsTotal}`,
    '# HELP http_request_duration_ms_sum Total accumulated HTTP request duration in milliseconds.',
    '# TYPE http_request_duration_ms_sum counter',
    `http_request_duration_ms_sum ${metrics.requestDurationMsTotal}`,
    '# HELP http_requests_by_status_total Total HTTP requests grouped by response status code.',
    '# TYPE http_requests_by_status_total counter',
    '# HELP http_requests_by_route_total Total HTTP requests grouped by normalized route.',
    '# TYPE http_requests_by_route_total counter',
  ];

  metrics.statusCounts.forEach((count, statusCode) => {
    lines.push(`http_requests_by_status_total{status_code="${escapePrometheusLabel(statusCode)}"} ${count}`);
  });

  metrics.routeCounts.forEach((count, route) => {
    lines.push(`http_requests_by_route_total{route="${escapePrometheusLabel(route)}"} ${count}`);
  });

  return lines.join('\n');
}

async function bootstrap() {
  const envPath = loadBackendEnv();
  requireJwtSecret();
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  const metrics: MetricsRegistry = {
    startedAtMs: Date.now(),
    requestsTotal: 0,
    requestDurationMsTotal: 0,
    statusCounts: new Map<string, number>(),
    routeCounts: new Map<string, number>(),
  };

  // FC-SEC-008 — the hop count is configuration, not a constant. It was hardcoded
  // to 1 while the default stack publishes port 3001 straight to the host with
  // nothing in front of it, which told Express to believe every X-Forwarded-For
  // it received. It has to agree with extractClientIp's TRUSTED_PROXY_HOPS, or
  // `req.ip` and the rate-limit key disagree about who the caller is.
  const trustedProxyHops = (() => {
    const configured = Number.parseInt(String(process.env.TRUSTED_PROXY_HOPS ?? '0').trim(), 10);
    return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 10) : 0;
  })();
  expressApp.set('trust proxy', trustedProxyHops);
  
  // SECURITY FIX: 2026-03-28 - Add authentication to /metrics endpoint
  const metricsAuthToken = String(process.env.METRICS_AUTH_TOKEN || '').trim();
  expressApp.get('/metrics', (req: Request, res: Response) => {
    // Require authentication token for metrics access
    const providedToken = req.headers['x-metrics-token'] || req.query['token'];
    if (metricsAuthToken && providedToken !== metricsAuthToken) {
      res.status(401).json({ error: 'Unauthorized access to metrics' });
      return;
    }
    // If no token configured, only allow localhost in production
    if (!metricsAuthToken && process.env.NODE_ENV === 'production') {
      const clientIp = extractClientIp(req);
      if (!['127.0.0.1', '::1', 'localhost'].includes(clientIp)) {
        res.status(401).json({ error: 'Unauthorized access to metrics' });
        return;
      }
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(renderMetrics(metrics));
  });
  app.setGlobalPrefix('api');

  const prisma = app.get(PrismaService);
  
  // SECURITY FIX: 2026-03-28 - Enable shutdown hooks for graceful database connection closure
  await prisma.enableShutdownHooks(app);
  
  AuditService.configurePrisma(prisma);
  await prisma.auditLog.count();
  await prisma.activeSession.count();
  const runtimeAuditService = new AuditService(prisma);
  
  // SECURITY FIX: 2026-03-28 - Store interval reference for cleanup
  const sessionPurgeInterval = setInterval(() => {
    void runtimeAuditService.purgeExpiredSessions().catch((error) => {
      console.error('[Audit Cleanup] Failed to purge expired sessions:', error instanceof Error ? error.message : String(error));
    });
  }, 5 * 60 * 1000);
  
  // Cleanup on shutdown
  process.on('SIGTERM', () => clearInterval(sessionPurgeInterval));
  process.on('SIGINT', () => clearInterval(sessionPurgeInterval));

  // ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
  app.use(cookieParser());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      metrics.requestsTotal += 1;
      metrics.requestDurationMsTotal += durationMs;
      incrementCounter(metrics.statusCounts, String(res.statusCode));
      incrementCounter(metrics.routeCounts, normalizeRequestPath(req));

      const logPayload = {
        event: 'http_request',
        method: req.method,
        path: normalizeRequestPath(req),
        statusCode: res.statusCode,
        durationMs,
        ip: extractClientIp(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(logPayload));
    });
    next();
  });

  // SECURITY FIX: 2026-03-28 - Removed auth body logging (password exposure)
  // Auth request monitor - sanitized version
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url.includes('auth') || req.url.includes('/auth')) {
      console.log(`\n[Auth Monitor] [Backend Entry] Incoming: ${req.method} ${req.url}`);
      console.log(`   [Auth Monitor] IP: ${extractClientIp(req)}`);
      // REMOVED: Body logging to prevent password/credential exposure in logs
    }
    next();
  });

  // FC-ITEM-IMPORT — the body parsers are registered *after* the rate limiter
  // below, not here. They used to run first, which meant every rejected request
  // still cost a full body read, a JSON.parse, and class-transformer
  // instantiation of up to 15,000 nested DTO objects before the limiter decided to
  // answer 429. Limiting after the expensive part is not limiting. The limit is
  // also configurable now so it can be kept in step with MAX_BULK_IMPORT_ROWS and
  // with `client_max_body_size` in the nginx configs, which are two more places
  // that decide whether a large import arrives at all.
  const jsonBodyLimit = String(process.env.JSON_BODY_LIMIT || '10mb').trim();

  const allowedOrigins = getAllowedOrigins();
  app.enableCors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalizedOrigin = typeof origin === 'string' ? normalizeOrigin(origin) : '';
      const allowCodespacesOrigin = String(process.env.ALLOW_CODESPACES_ORIGINS || '').toLowerCase() === 'true';

      if (process.env.NODE_ENV !== 'production') {
        if (isTrustedLocalOrigin(normalizedOrigin) || isGithubCodespacesOrigin(normalizedOrigin)) {
          return callback(null, true);
        }
        if (matchesConfiguredOrigin(normalizedOrigin, allowedOrigins)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      }

      if (matchesConfiguredOrigin(normalizedOrigin, allowedOrigins)) {
        return callback(null, true);
      }
      if (allowCodespacesOrigin && isGithubCodespacesOrigin(normalizedOrigin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Deliberately after CORS: a 429 must carry the CORS headers, or the browser
  // reports a CORS failure and the operator never learns the request was refused.
  // Deliberately before the body parsers: see the note at jsonBodyLimit above.
  app.use(globalRateLimiter);

  app.use(json({ limit: jsonBodyLimit }));
  app.use(urlencoded({ extended: true, limit: jsonBodyLimit }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // FC-SEC-007 — sits beside the global ValidationPipe for the same reason:
  // a unique- or foreign-key violation is a data-layer fact, not a
  // business rule, so it has no natural home in any single module.
  app.useGlobalFilters(new PrismaExceptionFilter());
  await app.listen(process.env.PORT || 3001);
  if (envPath) {
    console.log('Loaded env from', envPath);
  }
  console.log('Backend (Nest) listening on port', process.env.PORT || 3001);
}
bootstrap();
