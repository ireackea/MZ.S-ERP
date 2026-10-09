// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العامة - 2026-03-13
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Save, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { formatDateTime } from '@services/dateFormat';
import { toast } from '@services/toastService';
import {
  BINDINGS,
  EDITABLE_BINDINGS,
  loadSystemSettings,
  reportSettingsSave,
  saveSystemSettings,
  validateSettingsForm,
  type FieldIssue,
  type FieldMeta,
} from '@services/systemSettingsApi';
import type { SystemSettings } from '../../../types';

interface GeneralSettingsProps {
  settings: SystemSettings;
  onUpdateSettings: (settings: SystemSettings) => void;
  /**
   * Gate 4.10 — told whenever the form becomes dirty or clean.
   *
   * The screen guards the browser being closed (`beforeunload`) and nothing else, but
   * these panels are unmounted by a tab switch inside a single-page app — so leaving
   * by clicking another tab threw the edits away silently while the guard covered the
   * one exit that already had its own confirmation. The owner of the tabs needs to
   * know, and it cannot read this component's state.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdateSettings, onDirtyChange }) => {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('settings.view.general');
  const canEdit = hasPermission('settings.update.system');

  const [form, setForm] = useState<SystemSettings>(settings);
  /** What the server last told us, per field. Needed for provenance and for concurrency. */
  const [meta, setMeta] = useState<Record<string, FieldMeta>>({});
  /** The form as it was when the server last answered. Dirty is measured against this. */
  const [baseline, setBaseline] = useState<SystemSettings>(settings);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Gate 4.9 — a 409, kept separate from a read failure.
   *
   * `loadError` was one state for two unrelated events. A write conflict set it, and
   * the banner that reads it then claimed "the fields below may show default values
   * and not the saved ones" and disabled Save until a re-read. Both are false: the
   * read succeeded, those are the stored values plus what the operator typed, and
   * the only exit was a re-read that threw their edits away. It fails safe — the
   * concurrent write is never overwritten — so what was wrong is the screen lying
   * about its own state, which is the one thing a form must not do.
   */
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [reason, setReason] = useState('');

  /**
   * Fields the operator actually typed into.
   *
   * The load used to merge server values over the form unconditionally, so anything
   * typed while the request was in flight was overwritten by it — silently, and with the
   * operator's half-typed value gone. Tracking the touched fields lets the merge fill in
   * only what nobody is holding, and the screen can then say what happened instead of
   * quietly choosing for them.
   */
  const touchedFields = useRef<Set<keyof SystemSettings>>(new Set());
  const [serverArrivedAfterTyping, setServerArrivedAfterTyping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSystemSettings()
      .then((snapshot) => {
        if (cancelled) return;
        setMeta(snapshot.meta);
        setForm((current) => {
          const merged: Record<string, unknown> = { ...snapshot.form };
          for (const binding of EDITABLE_BINDINGS) {
            if (touchedFields.current.has(binding.field)) {
              merged[binding.field] = current[binding.field];
            }
          }
          return { ...current, ...merged } as SystemSettings;
        });
        setBaseline((current) => ({ ...current, ...snapshot.form }));
        if (touchedFields.current.size > 0) setServerArrivedAfterTyping(true);
      })
      .catch((error: any) => {
        if (cancelled) return;
        // A failed read must not blank the form, and it must not be silent either: the
        // values on screen are then the parent defaults, not the stored ones, and an
        // operator who cannot tell the difference will edit and save the wrong company
        // name over the real one. So the screen says which state it is in.
        const message = error?.message || 'تعذّر قراءة الإعدادات العامة من الخادم.';
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const issueFor = useCallback(
    (field: keyof SystemSettings) => issues.find((issue) => issue.field === field)?.message,
    [issues],
  );

  const dirty = useMemo(
    () =>
      EDITABLE_BINDINGS.some((binding) =>
        String(form[binding.field] ?? '') !== String(baseline[binding.field] ?? ''),
      ),
    [form, baseline],
  );

  const update = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    touchedFields.current.add(key);
    setForm((current) => ({ ...current, [key]: value }));
    // Clearing the message as soon as it is being fixed beats leaving a red line under
    // a field the operator has just corrected.
    setIssues((current) => (current.some((issue) => issue.field === key)
      ? current.filter((issue) => issue.field !== key)
      : current));
  };

  // Leaving with unsaved edits loses them with no trace, so the browser is asked.
  useEffect(() => {
    if (!dirty || saving) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, saving]);

  // Gate 4.10 - and the tab owner is told, so switching tabs asks instead of silently
  // dropping what was typed. Fired from an effect rather than from `update()`, because
  // the number of setters that can make a form dirty is the number of fields, and
  // this way there is one place.
  useEffect(() => {
    onDirtyChange?.(dirty && !saving);
  }, [dirty, saving, onDirtyChange]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit || saving || loading) return;

    const found = validateSettingsForm(form);
    if (found.length) {
      setIssues(found);
      toast.error(found[0].message);
      document.getElementById(`settings-field-${String(found[0].field)}`)?.focus();
      return;
    }

    try {
      setSaving(true);
      const { changed, snapshot } = await saveSystemSettings(form, meta, reason);
      reportSettingsSave(changed);
      setMeta(snapshot.meta);
      setForm((current) => ({ ...current, ...snapshot.form }));
      setBaseline((current) => ({ ...current, ...snapshot.form }));
      setReason('');
      setIssues([]);
      setConflictError(null);
      touchedFields.current.clear();
      setServerArrivedAfterTyping(false);
      // The store is what the report headers read, so it is updated from the server's
      // answer rather than from the form the operator typed.
      onUpdateSettings?.({ ...form, ...snapshot.form });
    } catch (error: any) {
      const status = error?.response?.status;
      const serverMessage = error?.response?.data?.message || error?.message;
      if (status === 409) {
        // Somebody else saved while this screen was open, so applying over the top
        // would discard their change invisibly. This branch says what to do about it
        // rather than falling through to a generic failure.
        setConflictError(serverMessage || 'عدّلها مستخدم آخر. أعد تحميل الصفحة ثم عدّل مجددًا.');
        toast.error(serverMessage || 'عدّلها مستخدم آخر. أعد تحميل الصفحة ثم عدّل مجددًا.');
        return;
      }
      toast.error(serverMessage || 'تعذّر حفظ الإعدادات العامة.');
    } finally {
      setSaving(false);
    }
  };

  const reloadFromServer = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void loadSystemSettings()
      .then((snapshot) => {
        setMeta(snapshot.meta);
        setForm((current) => ({ ...current, ...snapshot.form }));
        setBaseline((current) => ({ ...current, ...snapshot.form }));
        setIssues([]);
        touchedFields.current.clear();
        setServerArrivedAfterTyping(false);
      })
      .catch((error: any) => setLoadError(error?.message || 'تعذّر إعادة القراءة.'))
      .finally(() => setLoading(false));
  }, []);

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض الإعدادات العامة</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.general</code>.</div>
      </div>
    );
  }

  return (
    // `noValidate` is deliberate. With native validation on, the browser blocks the
    // submit and shows its own bubble for a blank `required` field — in the browser's
    // locale, naming no field of ours — so `validateSettingsForm`'s Arabic,
    // field-specific message never ran at all. Turning it off makes the message the
    // operator reads the one this screen writes, and the `required` attributes stay for
    // assistive technology.
    <form onSubmit={handleSave} noValidate className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-2xl font-black text-slate-900">الإعدادات العامة</h2>
        <p className="mt-2 text-sm text-slate-500">
          هوية النظام التي تظهر على المطبوعات والتقارير. قيم التشغيل الافتراضية للتفريغ وغرامة التأخير تُدار من قسم «الأقسام ووحدات القياس» وقواعد التفريغ.
        </p>
      </div>

      {loading && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          جارٍ قراءة الإعدادات المحفوظة من الخادم…
        </div>
      )}

      {conflictError && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-bold">تعارض الحفظ: عدّل هذا الإعداد مستخدم آخر.</div>
              <p className="mt-1">{conflictError}</p>
              <p className="mt-1">
                ما في الحقول أدناه هو القيم المحفوظة مضافًا إليها ما كتبته أنت — لم تُفقد.
                حدّث الشاشة لترى ما كتبه الآخر، أو عدّل ثم أعد الحفظ.
              </p>
              <button
                type="button"
                onClick={() => {
                  setConflictError(null);
                  reloadFromServer();
                }}
                className="mt-2 rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold"
              >
                حدّث الشاشة
              </button>
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-bold">تعذّر قراءة الإعدادات المحفوظة.</div>
              <p className="mt-1">{loadError}</p>
              <p className="mt-1">
                الحقول أدناه قد تعرض قيمًا افتراضية وليست المحفوظة. لا تحفظ قبل نجاح القراءة.
              </p>
              <button
                type="button"
                onClick={reloadFromServer}
                className="mt-2 rounded-xl border border-red-300 bg-white px-3 py-1.5 text-xs font-bold"
              >
                إعادة القراءة
              </button>
            </div>
          </div>
        </div>
      )}

      {serverArrivedAfterTyping && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          وصلت القيم المحفوظة بعد أن بدأت الكتابة، لذلك احتُفظ بما كتبته في الحقول التي لمستها. راجع الحقول قبل الحفظ.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {BINDINGS.filter((binding) => binding.editable).map((binding) => {
          const fieldMeta = meta[binding.field];
          const issue = issueFor(binding.field);
          const isText = binding.type === 'string';
          const rawValue = form[binding.field];
          return (
            <label
              key={binding.settingKey}
              className="space-y-2 text-sm font-semibold text-slate-700"
              htmlFor={`settings-field-${String(binding.field)}`}
            >
              <span className="flex items-center gap-2">
                {binding.label}
                {binding.required && <span className="text-red-500" aria-hidden="true">*</span>}
              </span>
              <input
                id={`settings-field-${String(binding.field)}`}
                value={isText ? String(rawValue ?? '') : Number(rawValue ?? 0)}
                onChange={(event) => {
                  // Gate 4.21 - `Number('')` is 0 and `Number('-')` is NaN.
                  //
                  // Both are printed on documents, so an emptied field writing a silent
                  // 0 is the worse of the two, and a stray dash writing NaN serialises
                  // to null on the wire and comes back as a bare English 400. The
                  // server refuses non-finite and negative values, but nothing here
                  // should be able to produce them for it to refuse.
                  //
                  // Unreachable today: no editable binding is numeric. That is exactly
                  // why it needs the guard before one becomes editable, rather than
                  // after.
                  if (!isText) {
                    const text = event.target.value;
                    const parsed = text.trim() === '' ? null : Number(text);
                    if (parsed === null || !Number.isFinite(parsed)) return;
                    update(
                      binding.field,
                      (parsed < 0 ? Math.abs(parsed) : parsed) as never,
                    );
                    return;
                  }
                  update(binding.field, event.target.value as never);
                }}
                required={binding.required}
                disabled={loading || saving}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? `settings-error-${String(binding.field)}` : undefined}
                className={`w-full rounded-2xl border px-4 py-3 ${issue ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
              />
              {issue && (
                <span id={`settings-error-${String(binding.field)}`} className="block text-xs font-bold text-red-600">
                  {issue}
                </span>
              )}
              {!issue && fieldMeta && (
                <span className="block text-xs font-normal text-slate-400">
                  {fieldMeta.isDefault
                    ? 'لم تُعدَّل بعد · القيمة الافتراضية'
                    : `آخر تعديل: ${formatDateTime(fieldMeta.updatedAt)}`}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {form.logoUrl && (
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <span className="text-sm font-semibold text-slate-700">معاينة الشعار</span>
          <img
            src={String(form.logoUrl)}
            alt="شعار الشركة"
            className="h-12 w-12 rounded-xl border border-slate-200 bg-white object-contain"
            onError={() => toast.error('تعذّر تحميل الشعار من هذا الرابط.')}
          />
          <span className="text-xs text-slate-500">إن لم تظهر الصورة، الرابط غير صحيح أو لا يسمح بالعرض الخارجي.</span>
        </div>
      )}

      <label className="block space-y-2 text-sm font-semibold text-slate-700">
        <span>سبب التغيير (اختياري)</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={loading || saving}
          maxLength={500}
          placeholder="مثال: تحديث الاسم بعد تغيير المالك"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3"
        />
        <span className="block text-xs font-normal text-slate-400">يُسجَّل مع القيم في سجل التدقيق، ويظهر لمن يراجع التقرير.</span>
      </label>

      <div className="flex items-center justify-end gap-3">
        {dirty && (
          <span className="text-xs font-bold text-amber-700">
            <Check size={14} className="inline" /> توجد تغييرات غير محفوظة
          </span>
        )}
        <button
          type="submit"
          disabled={saving || loading || !canEdit || !dirty || Boolean(loadError)}
          title={loadError
            ? 'لا يمكن الحفظ قبل نجاح قراءة الإعدادات المحفوظة.'
            : conflictError
              ? 'هناك تعارض مع حفظ آخر. راجع الملاحظة أعلاه ثم أعد المحاولة.'
              : undefined}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          <Save size={16} /> {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات العامة'}
        </button>
      </div>
    </form>
  );
};

export default GeneralSettings;