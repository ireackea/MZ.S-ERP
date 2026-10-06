import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The destructive budget was one counter for two acts that are not the same risk.
 *
 * ## What it cost
 *
 * Five operations per quarter hour, shared between restoring (which overwrites the live
 * database) and deleting an archive out of fifteen (which the retention pass does
 * automatically, with nobody present). Two calls per restore means the budget bought two
 * restores — and any operator clearing out old archives hit the ceiling meant for data
 * destruction.
 *
 * The only symptom was `Too many requests`, in English, with no wait time and no hint that
 * the ceiling is per person. That reads as a broken server, not a spent budget, so the
 * reasonable response is to retry — and to distrust the server rather than the limit.
 *
 * ## Why these are source-level assertions
 *
 * The limiter's decisions are private and are read from Express request objects. Driving
 * them through the HTTP surface would be the stronger test, and the e2e suite covers that
 * path; these assertions pin the *policy* — which bucket a path lands in, and what each
 * one is allowed to cost — so a merge cannot quietly merge them back into one number.
 */

/**
 * The backend suite runs with `cwd` set to `backend/`, so the file is a sibling rather
 * than nested. Resolving relative to this module avoids guessing which of the two it is —
 * the audit guards run from the repository root and the backend tests from `backend/`, and
 * a path written for one silently doubles under the other.
 */
const repoRoot = join(__dirname, '..', '..', '..');
const limiter = readFileSync(
  join(repoRoot, 'backend/src/security/global-rate-limit.ts'),
  'utf8',
);

describe('the two destructive acts are budgeted separately', () => {
  it('a restore and a delete land in different buckets', () => {
    expect(limiter).toMatch(/resolveBackupDestructiveClass\(req: Request\): 'backup-restore' \| 'backup-delete' \| null/);
    expect(limiter).toMatch(/return 'backup-restore';/);
    expect(limiter).toMatch(/return 'backup-delete';/);
  });

  it('each bucket has its own ceiling', () => {
    expect(limiter).toMatch(/case 'backup-restore':\s*return resolveDestructiveMax\(\);/);
    expect(limiter).toMatch(/case 'backup-delete':\s*return resolveDeleteMax\(\);/);
    // Restoring stays strict, because it destroys the live database.
    expect(limiter).toMatch(/BACKUP_DESTRUCTIVE_MAX[\s\S]{0,400}?\) return 5;/);
    // Deleting does not, because retention deletes by the same authority unattended.
    expect(limiter).toMatch(/BACKUP_DELETE_MAX[\s\S]{0,400}?\) return 40;/);
  });

  it('the old shared bucket is gone', () => {
    // One counter for both was the defect. If this string returns, someone has merged them.
    expect(limiter).not.toMatch(/'backup-destructive'/);
  });

  it('both buckets are keyed per session, so one person cannot spend another\'s', () => {
    const key = limiter.slice(
      limiter.indexOf('function resolveRateLimitKey'),
      limiter.indexOf('function resolveRateLimitKey') + 900,
    );
    expect(key).toMatch(/'backup-restore'/);
    expect(key).toMatch(/'backup-delete'/);
    expect(key).toMatch(/getSessionFingerprint/);
  });
});

describe('a refusal that can be acted on', () => {
  it('says how long to wait, in the body as well as the headers', () => {
    // The headers already carried `RateLimit-Reset: 900`. The body said "Too many
    // requests". The information existed and was not sent, which is the whole defect.
    expect(limiter).toMatch(/res\.setHeader\('Retry-After', String\(wait\)\)/);
    expect(limiter).toMatch(/retryAfterSeconds: wait,/);
  });

  it('does not answer in English, and names the limit that was hit', () => {
    expect(limiter).not.toMatch(/message: 'Too many requests'/);
    expect(limiter).toMatch(/trafficClass === 'backup-restore'/);
    expect(limiter).toMatch(/trafficClass === 'backup-delete'/);
  });

  it('reports the ceiling, so the operator can tell a limit from a fault', () => {
    expect(limiter).toMatch(/limit,/);
  });
});