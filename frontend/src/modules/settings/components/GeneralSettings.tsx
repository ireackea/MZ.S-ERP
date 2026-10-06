// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useRef, useState } from 'react';
import { Save, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { toast } from '@services/toastService';
import { loadSystemSettings, reportSettingsSave, saveSystemSettings } from '@services/systemSettingsApi';
import type { SystemSettings } from '../../../types';

interface GeneralSettingsProps {
  settings: SystemSettings;
  onUpdateSettings: (settings: SystemSettings) => void;
}

const sameSettings = (a: SystemSettings, b: SystemSettings) =>
  a.companyName === b.companyName &&
  a.currency === b.currency &&
  a.address === b.address &&
  a.phone === b.phone &&
  a.logoUrl === b.logoUrl &&
  a.defaultUnloadingDuration === b.defaultUnloadingDuration &&
  a.defaultDelayPenalty === b.defaultDelayPenalty;

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdateSettings, }) => {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('settings.view.general');
  const canEdit = hasPermission('settings.update.system');
  const [form, setForm] = useState<SystemSettings>(settings);
  const [saving, setSaving] = useState(false);
  // The last prop values this form was reset from. Resetting the form is right when
  // the parent genuinely has new values, and wrong when the parent re-renders with an
  // equal object: that discarded whatever the operator had typed.
  const synced = useRef<SystemSettings>(settings);

  useEffect(() => {
    if (sameSettings(synced.current, settings)) return;
    synced.current = settings;
    setForm(settings);
  }, [settings]);

  // Gate 2.1 - the screen opens on the server's answer, not on a client-only
  // default. Before, the form was seeded from a value the server had never seen,
  // and saving did nothing at all.
  useEffect(() => {
    let cancelled = false;
    void loadSystemSettings()
      .then((fresh) => {
        if (!cancelled && fresh && Object.keys(fresh).length) {
          setForm((current) => ({ ...current, ...fresh }));
        }
      })
      .catch((error: any) => {
        // A failed read must not blank the form, and it must not be silent either:
        // the values on screen are then the parent defaults, not the stored ones, and
        // an operator who cannot tell the difference will edit and save the wrong
        // company name over the real one.
        toast.error(error?.message || 'تعذّر قراءة الإعدادات العامة من الخادم.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!canView) {
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

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الإعدادات العامة.');
      return;
    }

    // Gate 3.4 — this used to be `onUpdateSettings(form); toast.success(...)`,
    // which wrote to a client-side store and reported success. There was no
    // server write at all: `saveSettings` had zero call sites and the backend had
    // no settings module, so the company name was back to its default on the next
    // reload, on every report that prints it.
    try {
      setSaving(true);
      const { changed } = await saveSystemSettings(form);
      reportSettingsSave(changed);
      // Re-read from the server rather than trusting the form, so a value the
      // server coerced is what the screen now shows.
      const fresh = await loadSystemSettings();
      setForm((current) => ({ ...current, ...fresh }));
      onUpdateSettings?.({ ...form, ...fresh });
    } catch (error: any) {
      toast.error(error?.message || 'تعذّر حفظ الإعدادات العامة.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-2xl font-black text-slate-900">الإعدادات العامة</h2>
        <p className="mt-2 text-sm text-slate-500">هوية النظام التي تظهر على المطبوعات والتقارير. قيم التشغيل الافتراضية للتفريغ وغرامة التأخير تُدار من قسم «الأقسام ووحدات القياس» وقواعد التفريغ.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>اسم الشركة</span>
          <input
            value={form.companyName}
            onChange={(e) => update('companyName', e.target.value)}
            required
            className="w-full rounded-2xl border border-slate-300 px-4 py-3"
          />
        </label>
        <label className="space-y-2 text-sm font-semibold text-slate-700">
          <span>العملة</span>
          <input
            value={form.currency}
            onChange={(e) => update('currency', e.target.value)}
            required
            className="w-full rounded-2xl border border-slate-300 px-4 py-3"
          />
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
      </div>

      <div className="flex justify-end">
        <button
                type="submit"
                disabled={saving || !canEdit}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
          <Save size={16} /> حفظ الإعدادات العامة
        </button>
      </div>
    </form>
  );
};

export default GeneralSettings;