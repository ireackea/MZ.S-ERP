// ENTERPRISE FIX: Phase 4 - Production Polish & Final Integration - 2026-03-05
// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { json, urlencoded } from 'express';
import { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';

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
    'http://localhost:5173,http://localhost:5174,http://localhost:3000';
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
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

async function bootstrap() {
  const envPath = loadBackendEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
  app.use(cookieParser());
  app.enableCors({
    origin: (origin, callback) => {
      const allowed = getAllowedOrigins();
      if (!origin || allowed.includes(origin) || isTrustedLocalOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

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
      const logPayload = {
        event: 'http_request',
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        ip: extractIp(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(logPayload));
    });
    next();
  });

  // 7"#"7"77"#⬑"#%  // [AUTH REQUEST MONITOR]
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
      const normalizedOrigin =
        typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      if (
        allowedOrigins.some((candidate) => candidate.replace(/\/+$/, '') === normalizedOrigin)
      ) {
        return callback(null, true);
      }
      if (isTrustedLocalOrigin(normalizedOrigin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT || 3001);
  if (envPath) {
    console.log('Loaded env from', envPath);
  }
  console.log('Backend (Nest) listening on port', process.env.PORT || 3001);
}
bootstrap();
