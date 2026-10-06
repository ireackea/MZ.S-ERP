import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';

/**
 * How many reverse proxies are in front of this process.
 *
 * 0 means there is none — the default stack publishes port 3001 straight to the
 * host — so `X-Forwarded-For` is written by the caller and carries no authority
 * whatsoever. Set it to 1 only where nginx actually sits in front, which is the
 * `nginx` profile in docker-compose.prod.yml.
 */
function trustedProxyHops(): number {
  const configured = Number.parseInt(String(process.env.TRUSTED_PROXY_HOPS ?? '0').trim(), 10);
  // Anything above a small bound is a misconfiguration, not a deep topology, and
  // treating it as real is how the fallback below ends up trusting a caller.
  if (!Number.isFinite(configured) || configured <= 0 || configured > 5) return 0;
  return configured;
}

export function extractClientIp(req: Request): string {
  const socketAddress = req.socket?.remoteAddress || req.ip || 'unknown';
  const hops = trustedProxyHops();
  if (hops === 0) return socketAddress;

  // Take the *right-most* untrusted hop, never the left-most one. Every proxy in
  // the chain appends the address it received the request from, so the left-most
  // entry is the one a caller can write. Reading it — as this did — meant a
  // client could send a fresh X-Forwarded-For on every request and receive a fresh
  // rate-limit bucket with it, which made every limit in this file optional.
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : typeof header === 'string' ? header : '';
  const chain = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (chain.length === 0) return socketAddress;

  // `chain.length > hops` is a safety condition, not an off-by-one. When the
  // header carries fewer entries than there are configured proxies, the chain
  // cannot describe the topology we think it does, and the only entry left to
  // read is the one the caller wrote. Falling back to the socket address is the
  // conservative answer; reading index 0 is the vulnerability itself.
  if (chain.length <= hops) return socketAddress;

  return chain[chain.length - hops] || socketAddress;
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
    '/api/unloading-rules',
    '/api/audit/logs',
    '/api/audit/sessions',
  ].some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

/**
 * B8 — the two actions in the product that destroy data, and nothing else.
 *
 * They were counted in the `fallback` bucket at 150 per 15 minutes, which is a
 * number chosen for writes that insert rows. A restore runs `pg_restore --clean`
 * and a delete removes the only copy of the database; neither is meaningfully
 * slowed by being rare, and both are preceded by a PIN that is the last thing
 * standing between a stolen session and the end of the data.
 *
 * The preview is counted too, and not as a formality: it takes a full `pg_dump` of
 * the live database (`createRestorePreview`), so it is both the expensive half of
 * the flow and the unlimited way to keep asking the question "is this PIN right".
 * Two calls per restore is the honest cost of the confirmation step, and five
 * leaves room for two attempts plus a mistake.
 */
/**
 * Which destructive bucket a request belongs to, and whether it is one at all.
 *
 * Two buckets rather than one, because overwriting the live database and deleting one of
 * fifteen archives are not the same act and must not spend the same budget.
 */
function resolveBackupDestructiveClass(req: Request): 'backup-restore' | 'backup-delete' | null {
  const method = String(req.method || '').toUpperCase();
  const path = normalizeRequestPath(req);
  const withoutPrefix = path.replace(/^\/api/, '');

  if (method === 'POST' && (withoutPrefix === '/backup/restore' || withoutPrefix === '/backup/legacy/restore')) {
    return 'backup-restore';
  }
  // `DELETE /backup/:id` - the literal prefix, so a nested path cannot slip past.
  if (method === 'DELETE' && /^\/backup\/[^/]+$/.test(withoutPrefix)) {
    return 'backup-delete';
  }
  return null;
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
  return resolveBackupDestructiveClass(req) || 'fallback';
}

function resolveRateLimitKey(req: Request) {
  const trafficClass = resolveTrafficClass(req);
  const clientIp = extractClientIp(req);

  if (
    trafficClass === 'bootstrap' ||
    trafficClass === 'authenticated-read' ||
    trafficClass === 'backup-restore' ||
    trafficClass === 'backup-delete'
  ) {
    return `${trafficClass}:${clientIp}:${getSessionFingerprint(req)}`;
  }

  // FC-ITEM-IMPORT — the fallback bucket is every authenticated write in the
  // product, and it was keyed by IP alone. That made the ceiling mean "150
  // requests per building per 15 minutes": every operator behind one office
  // router shared it, and each of those 150 requests can insert 250 rows. Adding
  // the session to the key makes it mean what a rate limit is supposed to mean,
  // which is per caller.
  if (trafficClass === 'fallback') {
    return `${trafficClass}:${clientIp}:${getSessionFingerprint(req)}`;
  }

  return `${trafficClass}:${clientIp}`;
}

function resolveMaxRequests(req: Request) {
  const trafficClass = resolveTrafficClass(req);

  switch (trafficClass) {
    case 'auth':
      return resolveAuthMax();
    case 'bootstrap':
      return 120;
    case 'authenticated-read':
      return 300;
    // B8 — five per quarter hour for the two destructive actions. Two calls per
    // restore (preview, then confirm) means two restores, plus one attempt that was
    // a mistake. The escalating lock in `BackupService` is the second half: this
    // ceiling bounds the honest operator, that one bounds the guesser.
    case 'backup-restore':
      return resolveDestructiveMax();
    case 'backup-delete':
      return resolveDeleteMax();
    default:
      return 150;
  }
}

/**
 * The destructive budget is split, because the two actions are not the same risk.
 *
 * **Restore** overwrites the live database. Two calls per restore (preview, then
 * confirm), so a ceiling of five allows two restores plus one mistake. The escalating PIN
 * lock in `BackupService` is the second half of that defence: this ceiling bounds the
 * honest operator, that one bounds the guesser.
 *
 * **Deleting an archive** is a different act. The operator may well hold fifteen of them
 * and be clearing out old ones, and the automatic retention pass deletes them by exactly
 * the same authority with no human present at all. Counting a click on «حذف» the same as
 * overwriting the database meant that ordinary cleanup work hit a limit designed for data
 * destruction — and the only symptom was `Too many requests`, in English, with no wait
 * time, which reads as a broken server rather than a spent budget.
 *
 * So the delete budget is generous on purpose. What actually protects archives is not
 * this counter: it is the refusal to remove the last copy, the `minCount` floor, and the
 * ceiling on safety snapshots — all of which apply to human and scheduler alike.
 */
function resolveDeleteMax() {
  const configured = Number.parseInt(String(process.env.BACKUP_DELETE_MAX ?? '').trim(), 10);
  // Absurd values are treated as absent rather than clamped: a limit of 10^9 is a
  // misconfiguration, and honouring it would remove the limit while looking configured.
  if (!Number.isFinite(configured) || configured < 1 || configured > 1000) return 40;
  return configured;
}

/**
 * Login attempts from one address.
 *
 * Every login request carries no session cookie yet, so its rate-limit key is the same
 * `anonymous` bucket for that address. Twenty in fifteen minutes is enough to stop a
 * brute-force probe, and also exactly enough for a failing test run to lock the whole
 * estate out — because the suite, like a user, sends dozens of logins from one address.
 *
 * The account is the real defence against guessing: a wrong password locks that account
 * (`lockoutUntil`) rather than slowing the address. So the address-level ceiling can be
 * generous without weakening that defence. `60` is enough for an honest test run or a
 * shared office, and still bounds a scripted spray.
 */
function resolveAuthMax() {
  const configured = Number.parseInt(String(process.env.AUTH_RATE_LIMIT_MAX ?? '').trim(), 10);
  if (!Number.isFinite(configured) || configured < 1 || configured > 1000) return 60;
  return configured;
}

function resolveDestructiveMax() {
  const configured = Number.parseInt(String(process.env.BACKUP_DESTRUCTIVE_MAX ?? '').trim(), 10);
  if (!Number.isFinite(configured) || configured < 1 || configured > 100) return 5;
  return configured;
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

/** The window every class shares. Named so the 429 can say how long to wait. */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const globalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: (req) => resolveMaxRequests(req),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveRateLimitKey(req),
  skip: (req) => isPreflightRequest(req) || isResetAttemptsPath(req) || isOperationalProbePath(req),
  /**
   * A refusal that can be acted on.
   *
   * This answered `Too many requests` and nothing else. The headers already carried
   * `RateLimit-Reset: 900`, so the wait was known and simply not sent — and the operator
   * was left guessing between "wait a moment", "wait 15 minutes", and "this is broken".
   *
   * It also gave no hint that the ceiling is *per operator*, which is the part that
   * matters when a limit is hit while doing something perfectly ordinary: the natural
   * reading is that the server is unwell, when in fact one person's budget is spent.
   */
  handler: (req: Request, res: Response) => {
    const trafficClass = resolveTrafficClass(req);
    const minutes = Math.ceil(RATE_LIMIT_WINDOW_MS / 60_000);
    const limit = resolveMaxRequests(req);
    const wait = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

    res.setHeader('Retry-After', String(wait));
    res.status(429).json({
      // Which limit was hit, how large it is, and how long to wait. The previous answer
      // was the English string `Too many requests` and nothing else, while the headers
      // already carried the reset time - the information existed and was not sent. In an
      // Arabic interface it read as a broken server rather than a spent budget.
      message:
        trafficClass === 'backup-restore'
          ? `تجاوزت الحد المسموح لعمليات الاستعادة: ${limit} عمليات كل ${minutes} دقيقة `
            + 'لكل مستخدم. الاستعادة تمسح قاعدة البيانات الحالية، لذلك الحد صارم. '
            + 'انتظر حتى انتهاء المدة ثم أعد المحاولة.'
          : trafficClass === 'backup-delete'
            ? `تجاوزت الحد المسموح لحذف النسخ: ${limit} عملية كل ${minutes} دقيقة لكل مستخدم. `
              + 'انتظر حتى انتهاء المدة ثم أعد المحاولة.'
            : `تجاوزت الحد المسموح للطلبات (${limit} كل ${minutes} دقيقة). أعد المحاولة بعد ${minutes} دقيقة.`,
      code: 'RATE_LIMIT_EXCEEDED',
      trafficClass,
      retryAfterSeconds: wait,
      limit,
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