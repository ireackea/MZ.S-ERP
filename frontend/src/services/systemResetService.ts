// ENTERPRISE FIX: Phase 7 - Advanced System Reset Module with Multi-Layer Security - 2026-04-29
// Two-factor reset workflow:
//   1) requestChallenge()   -> backend issues a one-time per-session code (5 min TTL)
//   2) executeReset(...)    -> backend validates env token + challenge + reason + scope
import apiClient from '../api/client';

export type SystemResetScope = 'full' | 'data' | 'inventory' | 'audit';

export interface ResetChallengeResponse {
  challengeId: string;
  challengeCode: string;
  expiresAt: string;
  ttlSeconds: number;
}

export interface SystemResetResponse {
  success: boolean;
  scope: SystemResetScope;
  message: string;
  timestamp: string;
  tablesAffected?: string[];
  backupId?: string | null;
}

export interface ExecuteResetParams {
  confirmationCode: string;
  challengeId: string;
  challengeCode: string;
  scope: SystemResetScope;
  reason: string;
  createBackup: boolean;
}

const normalizeApiMessage = (message: unknown): string | null => {
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message)) {
    const first = message.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    return first ? first.trim() : null;
  }
  return null;
};

const translateResetError = (code: string | null, message: string | null, retryAt?: string): string => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  switch (normalizedCode) {
    case 'SYSTEM_RESET_COOLDOWN':
      return retryAt
        ? `تم إيقاف محاولات إعادة الضبط مؤقتًا. حاول بعد ${new Date(retryAt).toLocaleString('ar-EG')}.`
        : 'تم إيقاف محاولات إعادة الضبط مؤقتًا. حاول لاحقًا.';
    case 'SYSTEM_RESET_INVALID_CODE':
      return 'رمز التأكيد غير صحيح. يرجى التواصل مع مدير النظام.';
    case 'SYSTEM_RESET_INVALID_CHALLENGE':
      return 'رمز التحقق المؤقت غير صالح أو انتهت صلاحيته. يرجى طلب رمز جديد.';
    case 'SYSTEM_RESET_SUPERADMIN_REQUIRED':
      return 'غير مصرح بتنفيذ إعادة الضبط. يُسمح بها فقط لدور SuperAdmin.';
    case 'SYSTEM_RESET_REASON_REQUIRED':
      return 'يجب إدخال سبب واضح لإعادة الضبط (10 أحرف على الأقل).';
    default:
      return message || 'تعذر إكمال إعادة ضبط النظام.';
  }
};

const extractApiError = (error: any): Error => {
  const responseData = error?.response?.data;
  const errorCode = typeof responseData?.code === 'string' ? responseData.code : null;
  const retryAt = typeof responseData?.retryAt === 'string' ? responseData.retryAt : undefined;
  const rawMessage = normalizeApiMessage(responseData?.message) || normalizeApiMessage(error?.message);
  return new Error(translateResetError(errorCode, rawMessage, retryAt));
};

export const systemResetService = {
  /**
   * Step 1: ask the backend to mint a one-time challenge code (shown ONCE in the UI).
   */
  async requestChallenge(scope: SystemResetScope): Promise<ResetChallengeResponse> {
    try {
      const { data } = await apiClient.post('/admin/reset-system/challenge', { scope });
      if (!data?.challengeId || !data?.challengeCode) {
        throw new Error('استجابة الخادم غير مكتملة لرمز التحقق.');
      }
      return {
        challengeId: String(data.challengeId),
        challengeCode: String(data.challengeCode),
        expiresAt: String(data.expiresAt || ''),
        ttlSeconds: Number(data.ttlSeconds || 300),
      };
    } catch (error: any) {
      throw extractApiError(error);
    }
  },

  /**
   * Step 2: execute the scoped reset using the env token + the challenge code + reason.
   */
  async executeReset(params: ExecuteResetParams): Promise<SystemResetResponse> {
    if (!params.confirmationCode || params.confirmationCode.trim().length < 16) {
      throw new Error('يرجى إدخال رمز تأكيد صالح (16 حرفًا على الأقل).');
    }
    if (!params.challengeId || !params.challengeCode) {
      throw new Error('رمز التحقق المؤقت مفقود — يرجى طلب رمز جديد.');
    }
    if (!params.reason || params.reason.trim().length < 10) {
      throw new Error('يرجى إدخال سبب واضح (10 أحرف على الأقل).');
    }

    try {
      const { data } = await apiClient.post('/admin/reset-system', {
        confirmationCode: params.confirmationCode.trim(),
        challengeId: params.challengeId.trim(),
        challengeCode: params.challengeCode.trim().toUpperCase(),
        scope: params.scope,
        reason: params.reason.trim(),
        createBackup: params.createBackup,
        auditReason: params.reason.trim(),
        timestamp: new Date().toISOString(),
      });
      return {
        success: true,
        scope: (data?.scope as SystemResetScope) || params.scope,
        message: data?.message || 'تمت إعادة ضبط النظام بنجاح.',
        timestamp: data?.timestamp || new Date().toISOString(),
        tablesAffected: Array.isArray(data?.tablesAffected) ? data.tablesAffected : undefined,
        backupId: data?.backupId ?? null,
      };
    } catch (error: any) {
      throw extractApiError(error);
    }
  },

  /**
   * Clear local browser state and bounce to /login. Called by the UI after a successful reset.
   */
  clearLocalStateAndRedirect(message?: string): void {
    const ff_theme = localStorage.getItem('ff_theme');
    const ff_lang = localStorage.getItem('ff_lang');
    const ff_api_url = localStorage.getItem('ff_api_url');
    const ff_features = localStorage.getItem('ff_features');

    localStorage.clear();
    sessionStorage.clear();

    if (ff_theme) localStorage.setItem('ff_theme', ff_theme);
    if (ff_lang) localStorage.setItem('ff_lang', ff_lang);
    if (ff_api_url) localStorage.setItem('ff_api_url', ff_api_url);
    if (ff_features) localStorage.setItem('ff_features', ff_features);

    localStorage.setItem('feed_factory_system_reset_complete', '1');
    if (message) localStorage.setItem('feed_factory_system_reset_message', message);
    window.location.href = '/login';
  },
};

export default systemResetService;
