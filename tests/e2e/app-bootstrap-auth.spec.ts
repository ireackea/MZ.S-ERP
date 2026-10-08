import { describe, expect, it } from 'vitest';
import { backendUrl } from './support/runtimeConfig';

/**
 * #17 — `GET /api/app/bootstrap` answered a caller with no session at all.
 *
 * `OptionalJwtAuthGuard` returns `true` even when authentication throws, setting
 * `request.user = undefined`, and `AppBootstrapService` had an explicit `if (!user)`
 * branch that assembled the payload anyway. So an anonymous GET returned HTTP 200 with:
 *
 *   - the whole reference dictionary,
 *   - every unloading rule, including `penalty_rate_per_minute` — a commercial number,
 *     not a UI string: it is what a penalty is *computed* from,
 *   - and three counts that disclose whether the system holds items, transactions or
 *     opening balances.
 *
 * Measured live before the fix: two active rules (`ميناء طرابلس` 240min @ 0.333/min,
 * `ميناء مصراتة` 120min @ 0.333/min) and `startupFlags.hasItems: true`, with no
 * credentials of any kind.
 *
 * These assertions are the claim. A guard that stops authenticating is worth nothing on
 * paper, so the check is the request, not the decorator.
 */
const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
};

describe('#17 the application bootstrap is not a public endpoint', () => {
  it('refuses a caller with no session', async () => {
    const { status } = await request('/app/bootstrap');
    expect(status).toBe(401);
  });

  it('refuses a forged bearer token', async () => {
    // A guard that only checks for the *presence* of an Authorization header would pass
    // this. The point of the guard is that the token is checked.
    const { status } = await request('/app/bootstrap', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(status).toBe(401);
  });

  it('discloses nothing to an anonymous caller, in any shape', async () => {
    // Status alone is not the claim — the claim is that no commercial figure and no
    // count escapes. Asserting on the body catches a guard that refuses while a
    // controller, a filter or an interceptor has already leaked the payload.
    const { body } = await request('/app/bootstrap');
    const serialised = JSON.stringify(body ?? {});
    expect(serialised).not.toMatch(/penalty_rate_per_minute/);
    expect(serialised).not.toMatch(/allowed_duration_minutes/);
    expect(serialised).not.toMatch(/startupFlags/);
    expect(serialised).not.toMatch(/hasItems|hasTransactions|hasOpeningBalances/);
  });
});