import { describe, expect, it } from 'vitest';
import { normalizeApiError } from './client';

/**
 * A 401 that reads "Request failed with status code 401", in an Arabic application.
 *
 * Every caller writes `toast.error(error?.message || 'عربي…')`, and axios always sets
 * `message`, so the Arabic fallback was unreachable for every HTTP failure — dead code
 * that only ever fired when there was no response at all. The operator saw English
 * wording for an expired session, with no indication that signing in again was the fix.
 */

const axiosError = (status: number, data: unknown) => ({
  message: `Request failed with status code ${status}`,
  isAxiosError: true,
  response: { status, data },
});

describe('the server\'s own wording wins over axios', () => {
  it('uses the message the backend sent', () => {
    const error = normalizeApiError(
      axiosError(400, { message: 'لا توجد مساحة كافية للنسخة: نحتاج 400 MiB والمتاح 120 MiB.' }),
    );
    expect(error.message).toContain('لا توجد مساحة كافية');
    // And specifically not the English default.
    expect(error.message).not.toMatch(/^Request failed/);
  });

  it('keeps the response intact, so callers that read the status still work', () => {
    const original = axiosError(409, { message: 'لا يمكن حذف النسخة الأخيرة.' });
    const error = normalizeApiError(original) as any;
    expect(error.response.status).toBe(409);
    expect(error.isAxiosError).toBe(true);
  });
});

describe('a 401 names the next action', () => {
  it('tells the operator to sign in again, in Arabic', () => {
    // The backend may send its own message; where it does not, the actionable half is
    // that the session ended, which is a fact about the browser rather than the server.
    const error = normalizeApiError(axiosError(401, {}));
    expect(error.message).toContain('تسجيل الدخول');
    expect(error.message).not.toMatch(/^Request failed/);
  });

  it('prefers the server message when there is one', () => {
    const error = normalizeApiError(
      axiosError(401, { message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }),
    );
    expect(error.message).toBe('اسم المستخدم أو كلمة المرور غير صحيحة.');
  });

  it('still answers when the body is missing or empty', () => {
    for (const data of [undefined, null, {}, { message: '' }, { message: '   ' }]) {
      const error = normalizeApiError(axiosError(401, data));
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toMatch(/^Request failed/);
    }
  });
});

describe('other statuses get wording that is about the right thing', () => {
  it('403 is a permission answer, not a failure', () => {
    expect(normalizeApiError(axiosError(403, {})).message).toContain('صلاحية');
  });

  it('5xx says the server is unavailable rather than repeating a number', () => {
    expect(normalizeApiError(axiosError(500, {})).message).toContain('الخادم');
    expect(normalizeApiError(axiosError(503, {})).message).not.toMatch(/^Request failed/);
  });

  it('a genuine non-HTTP message is preserved', () => {
    // A TypeError or a network-level failure has its own wording, and replacing it with
    // a generic sentence would lose information.
    const error = normalizeApiError({ message: 'Failed to fetch' });
    expect(error.message).toBe('Failed to fetch');
  });

  it('no response at all still says something useful', () => {
    const error = normalizeApiError({ message: 'Request failed' });
    expect(error.message).toContain('الخادم');
  });
});

describe('a rate-limit refusal says when to come back', () => {
  // This is the message an operator saw while deleting backups: the bare English string
  // "Too many requests", with the wait time sitting unused in a response header. It reads
  // as a fault rather than a spent budget, so the natural response is to keep retrying and
  // to distrust the server.
  it('uses the wait the server sent', () => {
    const error = normalizeApiError(
      axiosError(429, { message: 'تجاوزت الحد المسموح لحذف النسخ.', retryAfterSeconds: 900 }),
    );
    expect(error.message).toContain('تجاوزت الحد');
    expect(error.message).not.toMatch(/^Too many requests$/);
  });

  it('falls back to its own wording when the limiter says nothing useful', () => {
    // A limiter elsewhere in the stack, or a proxy, may answer without a message.
    const error = normalizeApiError(axiosError(429, {}));
    expect(error.message).toContain('الحد');
    expect(error.message).toContain('15');
    expect(error.message).not.toMatch(/^Too many requests$/);
  });

  it('computes the wait from the seconds given, not from a guess', () => {
    const error = normalizeApiError(axiosError(429, { retryAfterSeconds: 60 }));
    expect(error.message).toContain('1');
    expect(error.message).not.toContain('15');
  });

  it('ignores a nonsensical retry value rather than printing it', () => {
    // "Retry after NaN minutes" would be worse than no number.
    for (const bad of [0, -30, 'soon', null]) {
      const error = normalizeApiError(axiosError(429, { retryAfterSeconds: bad }));
      expect(error.message).toContain('15');
      expect(error.message).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe('it cannot throw while handling a failure', () => {
  it('when the error object is frozen', () => {
    const frozen = Object.freeze({ message: 'Request failed with status code 401' });
    // Assigning `.message` on a frozen object throws in strict mode. Wrapping is the
    // whole reason that branch exists: an interceptor that throws while normalising an
    // error replaces a useful message with an obscure one.
    const error = normalizeApiError(frozen);
    expect(error.message).toContain('الخادم');
  });

  it('when given nothing at all', () => {
    for (const empty of [undefined, null, {}, 0, '']) {
      const error = normalizeApiError(empty);
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});