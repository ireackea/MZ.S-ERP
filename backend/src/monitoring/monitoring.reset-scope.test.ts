import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitoringService } from './monitoring.service';

/**
 * A reset challenge was not bound to the scope it was minted for.
 *
 * `POST /admin/reset-system/challenge` has carried `scope` in its body all along, and
 * `issueResetChallenge` took the DTO as `_dto` and ignored it. So a challenge minted
 * while reading the `audit` scope — the narrowest one, which clears the audit table
 * and logs every session out — authorised the `full` reset that clears the items and
 * the sales documents as well.
 *
 * The confirmation ritual was therefore over a different question than the one the
 * challenge answered, which is the one property a second factor has to have.
 *
 * The scope is now minted into the challenge and compared at execution.
 */
// The constructor takes five; only the first and the audit service matter to the
// challenge path, and the audit recorder reaches for `logItemAction` on both, so the
// stub has to answer both.
const prisma = { systemSetting: { findUnique: vi.fn() } };
const audit = { log: vi.fn().mockResolvedValue(undefined), logItemAction: vi.fn().mockResolvedValue(undefined) };
const service = new MonitoringService(
  prisma as never,
  { probeConnection: vi.fn() } as never,
  audit as never,
  {} as never,
  {} as never,
);

// The service reads a flat `role` string off the request user, not a nested role.
const superAdmin = { id: 'u1', username: 'super', role: 'SuperAdmin' };

const issue = (scope: string) =>
  (service as unknown as { issueResetChallenge: (d: unknown, u: unknown, m: unknown) => Promise<{ challengeId: string; challengeCode: string }> })
    .issueResetChallenge({ scope }, superAdmin, { ip: '127.0.0.1', userAgent: 'test' });

const consume = (challengeId: string, code: string, scope: string) =>
  (service as unknown as {
    consumeChallenge: (id: string, code: string, actorKey: string, now: number, scope?: string) => unknown;
  }).consumeChallenge(challengeId, code, 'id:u1', Date.now() + 1, scope);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.systemSetting.findUnique.mockResolvedValue(null);
});

describe('a reset challenge is bound to the scope it was minted for', () => {
  it('accepts the same scope', async () => {
    const { challengeId, challengeCode } = await issue('audit');
    expect(consume(challengeId, challengeCode, 'audit')).toEqual({ ok: true });
  });

  it('refuses a wider scope than the one minted', async () => {
    // The direction that matters: minted against the narrow scope, executed against
    // the widest one. This is what was reachable before.
    const { challengeId, challengeCode } = await issue('audit');
    expect(consume(challengeId, challengeCode, 'full')).toEqual({ ok: false, reason: 'SCOPE_MISMATCH' });
  });

  it('refuses a different narrow scope', async () => {
    const { challengeId, challengeCode } = await issue('audit');
    expect(consume(challengeId, challengeCode, 'inventory')).toEqual({ ok: false, reason: 'SCOPE_MISMATCH' });
  });

  it('is single-use even when the scope matches', async () => {
    const { challengeId, challengeCode } = await issue('audit');
    expect(consume(challengeId, challengeCode, 'audit')).toEqual({ ok: true });
    expect(consume(challengeId, challengeCode, 'audit')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
