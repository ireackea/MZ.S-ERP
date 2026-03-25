// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useState } from 'react';
import { Save, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { toast } from '@services/toastService';
import type { SystemSettings } from '../../../types';

interface GeneralSettingsProps {
  settings: SystemSettings;
  onUpdateSettings: (settings: SystemSettings) => void;
  forceAccess?: boolean;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdateSettings, forceAccess = false }) => {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('settings.view.general');
  const canEdit = hasPermission('settings.update.system');
  const [form, setForm] = useState<SystemSettings>(settings);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  if (!forceAccess && !canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض الإعدادات العامة</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.general</code>.</div>
      </div>
    );
  }

  const update = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!forceAccess && !canEdit) {
      toast.error('لا تملك صلاحية تعديل الإعدادات العامة.');
      return;
    }
    onUpdateSettings(form);
    toast.success('تم حفظ الإعدادات العامة بنجاح.');
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-2xl font-black text-slate-900">الإعدادات العامة</h2>
        <p className="mt-2 text-sm text-slate-500">الهوية الأساسية للنظام وقيم التشغيل الافتراضية المستخدمة عبر الشاشات.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>اسم الشركة</span>
          <input value={form.companyName} onChange={(e) => update('companyName', e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>العملة</span>
          <input value={form.currency} onChange={(e) => update('currency', e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700 md:col-span-2">
          <span>العنوان</span>
          <input value={form.address} onChange={(e) => update('address', e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>الهاتف</span>
          <input value={form.phone} onChange={(e) => update('phone', e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>رابط الشعار</span>
          <input value={form.logoUrl || ''} onChange={(e) => update('logoUrl', e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>المدة الافتراضية للتفريغ بالدقائق</span>
          <input type="number" value={form.defaultUnloadingDuration ?? 0} onChange={(e) => update('defaultUnloadingDuration', Number(e.target.value || 0))} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>غرامة التأخير الافتراضية</span>
          <input type="number" value={form.defaultDelayPenalty ?? 0} onChange={(e) => update('defaultDelayPenalty', Number(e.target.value || 0))} className="w-full rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">
          <Save size={16} /> حفظ الإعدادات العامة
        </button>
      </div>
    </form>
  );
};

export default GeneralSettings;