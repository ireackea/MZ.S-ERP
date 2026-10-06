// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Vite Proxy for Backend API - 2026-02-26

import axios from 'axios';
import { markBootstrapRequest } from '@utils/bootstrapMetrics';
import { clearAllAuthData } from '@services/authSession';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

const toPath = (url: string) => (url.startsWith('/') ? url : `/${url}`);
const hasApiPrefix = (path: string) => /^\/api(\/|$)/.test(path);
const baseIncludesApiPrefix = (baseURL: string) => {
  const normalized = baseURL.trim().replace(/\/+$/, '');
  return /\/api$/i.test(normalized);
};

apiClient.interceptors.request.use((config) => {
  const headers = (config.headers ?? {}) as Record<string, string>;
  const url = String(config.url || '');
  const baseURL = String(config.baseURL ?? apiClient.defaults.baseURL ?? '');

  if (url && !/^https?:\/\//i.test(url)) {
    const path = toPath(url);
    config.url = hasApiPrefix(path) || baseIncludesApiPrefix(baseURL) ? path : `/api${path}`;
  }

  markBootstrapRequest(String(config.method || 'GET').toUpperCase(), String(config.url || ''));

  // B21 — drop the default `application/json` for a FormData body.
  //
  // A `multipart/form-data` request only parses if its Content-Type carries the
  // boundary the runtime generated. The browser sets that header itself, and only
  // when it is allowed to: an explicit Content-Type — including the one this client
  // sets on every request — replaces it, and the body arrives as `application/json`
  // with no boundary. The server then sees zero files and answers "no file was
  // attached", which is what the backup import did until this was fixed.
  //
  // It is worth stating that an end-to-end test missed this entirely: it posted a
  // real `FormData` through bare `fetch`, which does the right thing, so it proved
  // the *server* accepts an upload and said nothing about the *button*. The two
  // paths are not the same code, and a test that uses a different client is a test of
  // a different thing.
  const isMultipart = typeof FormData !== 'undefined' && config.data instanceof FormData;
  if (isMultipart) {
    delete headers['Content-Type'];
    delete headers['content-type'];
  }

  config.headers = headers as any;
  return config;
});

/**
 * Turn a rejected axios error into one a person can read.
 *
 * ## Why this exists
 *
 * Every caller writes `toast.error(error?.message || 'عربي…')`. That fallback is
 * unreachable for any HTTP failure, because axios always populates `message` with the
 * English string `"Request failed with status code 401"`. So an Arabic application
 * reported every server-side problem — an expired session, a permission refusal, a full
 * disk — in English, and the Arabic text written beside it was dead code that only ever
 * appeared when there was no response at all (a network drop).
 *
 * The server already sends the right words. Nest's default body carries `message`, and
 * this codebase's own handlers add it too, so the fix is to prefer it over axios's
 * generic wording rather than to invent new copy per status code.
 *
 * ## Why a 401 is worded differently
 *
 * A 401 is not a server-side complaint, it is a statement about the person using the
 * browser: their session ended. Telling them "sign in again" is the actionable half;
 * the generic wording leaves them reloading a page that cannot succeed.
 */
export const normalizeApiError = (error: any): Error => {
  const status = error?.response?.status ?? error?.status ?? null;
  const serverMessage = error?.response?.data?.message;

  let message: string;
  if (typeof serverMessage === 'string' && serverMessage.trim().length > 0) {
    message = serverMessage;
  } else if (status === 401) {
    message = 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول من جديد.';
  } else if (status === 403) {
    message = 'ليست لديك صلاحية لهذا الإجراء.';
  } else if (status === 429) {
    // A refusal the operator can act on. The server sends `retryAfterSeconds` and the
    // wording that names which limit was hit; this only covers a limiter that answered
    // without either, which is the case that used to surface as bare English
    // "Too many requests" in an Arabic interface.
    const retryAfter = Number(error?.response?.data?.retryAfterSeconds);
    const waitMinutes =
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter / 60) : 15;
    message =
      typeof serverMessage === 'string' && serverMessage.trim().length > 0
        ? serverMessage
        : `تم تجاوز الحد المسموح للعمليات. أعد المحاولة بعد ${waitMinutes} دقيقة.`;
  } else if (typeof status === 'number' && status >= 500) {
    message = 'الخادم غير متاح حالياً. يرجى المحاولة بعد قليل.';
  } else if (error?.message && !/^Request failed/.test(error.message)) {
    // A genuine message from somewhere other than the HTTP layer (a TypeError, say).
    message = error.message;
  } else {
    message = 'تعذّر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.';
  }

  // Kept on the original object too, so nothing downstream that reads `.response` loses
  // the status — only the human-facing wording changes.
  try {
    error.message = message;
    return error;
  } catch {
    const wrapped = new Error(message);
    (wrapped as any).status = status;
    (wrapped as any).response = error?.response;
    (wrapped as any).cause = error;
    return wrapped;
  }
};

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      clearAllAuthData();
    }
    return Promise.reject(normalizeApiError(error));
  },
);

export default apiClient;
