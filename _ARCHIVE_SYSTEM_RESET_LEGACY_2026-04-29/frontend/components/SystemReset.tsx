// SECURITY FIX: 2026-03-28 - Removed forceAccess prop bypass
import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';
import { toast } from '@services/toastService';
import { systemResetService } from '@services/systemResetService';

// SECURITY FIX: 2026-03-28 - Removed forceAccess prop entirely
const SystemReset: React.FC = () => {
  const { hasPermission } = usePermissions();
  const { data: session } = useSession();
  const [confirmationCode, setConfirmationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const canViewReset = hasPermission('settings.view.reset');
  const isSuperAdmin = String(session?.user?.role || '').toLowerCase() === 'superadmin';
  const canExecuteReset = hasPermission('admin.reset_system') && isSuperAdmin;

  // SECURITY FIX: 2026-03-28 - Only permission check, no bypass
  if (!canViewReset) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض إعادة الضبط</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.reset</code>.</div>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await systemResetService.performCompleteSystemReset(confirmationCode.trim());
      toast.success(response.message);
      setConfirmationCode('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'تعذر تنفيذ إعادة الضبط.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
        <AlertTriangle className="mt-0.5" size={20} />
        <div>
          <div className="font-black">إعادة ضبط النظام</div>
          <div className="mt-1 text-sm">هذا الإجراء شديد الخطورة ويجب تنفيذه فقط عند الحاجة القصوى. أدخل رمز التأكيد الذي حصلت عليه من المسؤول.</div>
        </div>
      </div>
      <label className="block space-y-2 text-sm font-semibold text-slate-700">
        <span>رمز التأكيد</span>
        <input 
          value={confirmationCode} 
          onChange={(e) => setConfirmationCode(e.target.value)} 
          placeholder="أدخل رمز التأكيد" 
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono" 
          autoComplete="off"
        />
      </label>
      {!canExecuteReset && (
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          لا يمكن تنفيذ إعادة الضبط إلا بدور <code>SuperAdmin</code> مع الصلاحية <code>admin.reset_system</code>.
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <button type="submit" disabled={loading || !confirmationCode.trim() || !canExecuteReset} className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
          {loading ? 'جارٍ التنفيذ...' : 'تنفيذ إعادة الضبط'}
        </button>
      </div>
    </form>
  );
};

export default SystemReset;
