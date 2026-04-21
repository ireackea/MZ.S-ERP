import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';

export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].split(',')[0].trim();
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function normalizeRequestPath(req: Request): string {
  return req.path || req.url.split('?')[0] || '/';
}

function isAuthPath(req: Request) {
  const path = normalizeRequestPath(req);
  return path.startsWith('/auth/') || path.startsWith('/api/auth/');
}

function isBootstrapPath(req: Request) {
  const path = normalizeRequestPath(req);
  return path === '/app/bootstrap' || path === '/api/app/bootstrap' || path.endsWith('/auth/me') || path.endsWith('/api/auth/me');
}

function isAuthenticatedReadPath(req: Request) {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET') return false;

  const path = normalizeRequestPath(req);
  return [
    '/api/items',
    '/api/transactions',
    '/api/users',
    '/api/users/roles',
    '/api/formulations',
    '/api/opening-balances',
  ].some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

function getSessionFingerprint(req: Request) {
  const rawToken = String((req as any)?.cookies?.['feed_factory_jwt'] || '').trim();
  if (!rawToken) return 'anonymous';
  return createHash('sha256').update(rawToken).digest('hex').slice(0, 12);
}

function resolveTrafficClass(req: Request) {
  if (isAuthPath(req)) return 'auth';
  if (isBootstrapPath(req)) return 'bootstrap';
  if (isAuthenticatedReadPath(req)) return 'authenticated-read';
  return 'fallback';
}

function resolveRateLimitKey(req: Request) {
  const trafficClass = resolveTrafficClass(req);
  const clientIp = extractClientIp(req);

  if (trafficClass === 'bootstrap' || trafficClass === 'authenticated-read') {
    return `${trafficClass}:${clientIp}:${getSessionFingerprint(req)}`;
  }

  return `${trafficClass}:${clientIp}`;
}

function resolveMaxRequests(req: Request) {
  const trafficClass = resolveTrafficClass(req);

  switch (trafficClass) {
    case 'auth':
      return 20;
    case 'bootstrap':
      return 120;
    case 'authenticated-read':
      return 300;
    default:
      return 150;
  }
}

function isResetAttemptsPath(req: Request) {
  const path = normalizeRequestPath(req);
  return path.endsWith('/auth/reset-attempts') || path.endsWith('/api/auth/reset-attempts');
}

function isPreflightRequest(req: Request) {
  return String(req.method || '').toUpperCase() === 'OPTIONS';
}

function isOperationalProbePath(req: Request) {
  const path = normalizeRequestPath(req);
  return path === '/health' || path === '/api/health' || path === '/metrics' || path === '/api/metrics';
}

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => resolveMaxRequests(req),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveRateLimitKey(req),
  skip: (req) => isPreflightRequest(req) || isResetAttemptsPath(req) || isOperationalProbePath(req),
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      message: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      trafficClass: resolveTrafficClass(req),
    });
  },
});

export function resetGlobalRateLimit(req: Request) {
  const resetKey = (globalRateLimiter as unknown as { resetKey?: (key: string) => void }).resetKey;
  if (typeof resetKey !== 'function') return;

  resetKey(resolveRateLimitKey(req));

  // Clear the legacy raw-IP bucket too in case older limiter state still exists.
  resetKey(extractClientIp(req));
}