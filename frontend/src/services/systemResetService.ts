// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
import apiClient from '../api/client';
import { toast } from '@services/toastService';

export interface SystemResetResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

export const systemResetService = {
  async performCompleteSystemReset(confirmationCode: string): Promise<SystemResetResponse> {
    console.log('[DEBUG-SERVICE] Service Called with code:', confirmationCode);
    
    // 3.1: Strict validation of the exact code
    if (confirmationCode !== 'CONFIRM_SYSTEM_RESET_2026') {
      throw new Error('رمز التأكيد غير صحيح. يجب إدخال: CONFIRM_SYSTEM_RESET_2026');
    }

    try {
      console.log('[DEBUG-SERVICE] Sending POST to /admin/reset-system...');
      const response = await apiClient.post('/admin/reset-system', {
        confirmationCode,
        auditReason: 'SuperAdmin Manual System Reset',
        timestamp: new Date().toISOString()
      });
      console.log('[DEBUG-SERVICE] Raw Response:', response);
      const { data } = response;

      this._clearLocalState();

      return {
        success: true,
        message: data?.message || 'تمت إعادة ضبط النظام بنجاح',
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('[DEBUG-SERVICE] API Error Details:', error.response?.data || error.message);
      const errorMessage = error?.response?.data?.message || 'تعذر إكمال إعادة ضبط النظام';
      throw new Error(errorMessage);
    }
  },

  _clearLocalState() {
    // ENTERPRISE FIX: Phase 0 - Blueprint-Compliant Selective Clear - 2026-03-02
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
    console.log('[SystemResetService] Local storage cleared selectively.');
    window.location.href = '/login';
  }
};

