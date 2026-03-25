// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { json, urlencoded } from 'express';
import { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit/audit.service';

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02

function loadBackendEnv() {
  const candidates = [
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const isBackendEnv = envPath.endsWith(path.join('backend', '.env'));
      const raw = fs.readFileSync(envPath, 'utf8');
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .forEach((line) => {
          const idx = line.indexOf('=');
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && (isBackendEnv || process.env[key] === undefined)) {
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

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].split(',')[0].trim();
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
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

  expressApp.set('trust proxy', 1);
  expressApp.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(renderMetrics(metrics));
  });
  app.setGlobalPrefix('api');

  const prisma = app.get(PrismaService);
  AuditService.configurePrisma(prisma);
  await prisma.auditLog.count();
  await prisma.activeSession.count();
  const runtimeAuditService = new AuditService(prisma);
  setInterval(() => {
    void runtimeAuditService.purgeExpiredSessions().catch((error) => {
      console.error('[Audit Cleanup] Failed to purge expired sessions:', error instanceof Error ? error.message : String(error));
    });
  }, 5 * 60 * 1000);

  // ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
  app.use(cookieParser());
  const rateLimitWindowMs = 60 * 1000;
  const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE || 100);
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const ip = extractIp(req);
    const now = Date.now();
    const existing = rateBuckets.get(ip);

    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    } else {
      existing.count += 1;
      rateBuckets.set(ip, existing);
    }

    const bucket = rateBuckets.get(ip)!;
    const retryAfterMs = Math.max(0, bucket.resetAt - now);

    res.setHeader('X-RateLimit-Limit', String(rateLimitPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimitPerMinute - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > rateLimitPerMinute) {
      res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({
        message: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
      });
      return;
    }

    next();
  });

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
        ip: extractIp(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(logPayload));
    });
    next();
  });

  // ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
  // Auth request monitor
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url.includes('auth') || req.url.includes('/auth')) {
      console.log(`\n[Auth Monitor] [Backend Entry] Incoming: ${req.method} ${req.url}`);
      console.log(`   [Auth Monitor] IP: ${extractIp(req)}`);
      if (req.body && Object.keys(req.body).length > 0) {
        console.log(`   [Auth Monitor] Body: ${JSON.stringify(req.body).substring(0, 100)}`);
      }
    }
    next();
  });

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

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
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT || 3001);
  if (envPath) {
    console.log('Loaded env from', envPath);
  }
  console.log('Backend (Nest) listening on port', process.env.PORT || 3001);
}
bootstrap();
