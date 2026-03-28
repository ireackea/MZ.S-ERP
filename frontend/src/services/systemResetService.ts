// SECURITY FIX: 2026-03-28 - Removed hardcoded confirmation code
// Confirmation code must now come from the backend
import apiClient from '../api/client';
import { toast } from '@services/toastService';

export interface SystemResetResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

export const systemResetService = {
  async performCompleteSystemReset(confirmationCode: string): Promise<SystemResetResponse> {
    // SECURITY FIX: 2026-03-28 - Removed client-side validation of confirmation code
    // The backend now validates the code against SYSTEM_RESET_TOKEN environment variable
    if (!confirmationCode || confirmationCode.trim().length < 10) {
      throw new Error('يرجى إدخال رمز التأكيد الكامل');
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
      const errorMessage = error?.response?.data?.message || 'تعذر إكمال إعادة ضبط النظام';
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
