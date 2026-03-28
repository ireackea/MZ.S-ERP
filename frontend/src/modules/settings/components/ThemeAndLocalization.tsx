// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import i18n from '../../../i18n';
import ThemeSettings from '../pages/ThemeSettings';

interface ThemeAndLocalizationProps {
  forceAccess?: boolean;
}

const ThemeAndLocalization: React.FC<ThemeAndLocalizationProps> = ({ forceAccess = false }) => {
  const { hasPermission } = usePermissions();

  if (!forceAccess && !hasPermission('settings.view.localization')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض الثيم واللغة</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.localization</code>.</div>
      </div>
    );
  }

  const changeLanguage = async (value: string) => {
    await i18n.changeLanguage(value);
  };

  return (
    <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-2xl font-black text-slate-900">الثيم واللغة</h2>
        <p className="mt-2 text-sm text-slate-500">إعدادات الواجهة العامة وتبديل اللغة الفعالة داخل التطبيق.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>اللغة</span>
          <select value={i18n.language || 'ar'} onChange={(e) => void changeLanguage(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3">
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
          تم تعطيل تبديل الثيمات الديناميكي، لذلك يبقى المظهر الكلاسيكي المؤسسي هو الافتراضي الحالي.
        </div>
      </div>
      <ThemeSettings />
    </div>
  );
};

export default ThemeAndLocalization;