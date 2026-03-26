import type { Request, Response } from 'express';
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

function isResetAttemptsPath(req: Request) {
  const path = normalizeRequestPath(req);
  return path.endsWith('/auth/reset-attempts') || path.endsWith('/api/auth/reset-attempts');
}

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => extractClientIp(req),
  skip: (req) => isResetAttemptsPath(req),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      message: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  },
});

export function resetGlobalRateLimit(req: Request) {
  const resetKey = (globalRateLimiter as unknown as { resetKey?: (key: string) => void }).resetKey;
  if (typeof resetKey !== 'function') return;
  resetKey(extractClientIp(req));
}