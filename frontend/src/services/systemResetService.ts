// SECURITY FIX: 2026-03-28 - Removed hardcoded confirmation code
// Confirmation code must now come from the backend
import apiClient from '../api/client';

export interface SystemResetResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

const normalizeApiMessage = (message: unknown): string | null => {
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  if (Array.isArray(message)) {
    const first = message.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    return first ? first.trim() : null;
  }

  return null;
};

const translateResetError = (code: string | null, message: string | null, retryAt?: string): string => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (normalizedCode === 'SYSTEM_RESET_COOLDOWN') {
    if (retryAt) {
      return `تم إيقاف محاولات إعادة الضبط مؤقتًا. يمكنك المحاولة بعد ${retryAt}.`;
    }
    return 'تم إيقاف محاولات إعادة الضبط مؤقتًا. حاول لاحقًا.';
  }

  if (normalizedCode === 'SYSTEM_RESET_INVALID_CODE') {
    return 'رمز التأكيد غير صحيح. يرجى التواصل مع مدير النظام.';
  }

  if (normalizedCode === 'SYSTEM_RESET_SUPERADMIN_REQUIRED') {
    return 'غير مصرح بتنفيذ إعادة الضبط. يُسمح بها فقط لدور SuperAdmin.';
  }

  if (!message) {
    return 'تعذر إكمال إعادة ضبط النظام';
  }

  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('invalid confirmation code')) {
    return 'رمز التأكيد غير صحيح. يرجى التواصل مع مدير النظام.';
  }
  if (lowerMessage.includes('too many invalid reset attempts')) {
    return 'تم إيقاف محاولات إعادة الضبط مؤقتًا بسبب تكرار الإدخال الخاطئ. حاول لاحقًا.';
  }
  if (lowerMessage.includes('only superadmin')) {
    return 'غير مصرح بتنفيذ إعادة الضبط. يُسمح بها فقط لدور SuperAdmin.';
  }

  return message;
};

export const systemResetService = {
  async performCompleteSystemReset(confirmationCode: string): Promise<SystemResetResponse> {
    // SECURITY FIX: 2026-03-28 - Removed client-side validation of confirmation code
    // The backend now validates the code against SYSTEM_RESET_TOKEN environment variable
    if (!confirmationCode || confirmationCode.trim().length < 16) {
      throw new Error('يرجى إدخال رمز تأكيد صالح (16 حرفًا على الأقل)');
    }

    try {
      const response = await apiClient.post('/admin/reset-system', {
        confirmationCode: confirmationCode.trim(),
        auditReason: 'SuperAdmin Manual System Reset',
        timestamp: new Date().toISOString()
      });
      const { data } = response;

      this._clearLocalState();

      return {
        success: true,
        message: data?.message || 'تمت إعادة ضبط النظام بنجاح',
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      const responseData = error?.response?.data;
      const errorCode = typeof responseData?.code === 'string' ? responseData.code : null;
      const retryAt = typeof responseData?.retryAt === 'string' ? responseData.retryAt : undefined;
      const rawMessage = normalizeApiMessage(responseData?.message) || normalizeApiMessage(error?.message);
      const errorMessage = translateResetError(errorCode, rawMessage, retryAt);
      throw new Error(errorMessage);
    }
  },

  _clearLocalState() {
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
    window.location.href = '/login';
  }
};
