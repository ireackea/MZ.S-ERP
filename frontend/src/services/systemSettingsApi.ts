import { toast } from '@services/toastService';
import apiClient from '@api/client';
import type { SystemSettings } from '../types';

/**
 * Gate 2.1 / 3.4 — the settings screen's only path to the server.
 *
 * It loads, it saves, and it reports what actually happened. The previous
 * `handleSave` called a Zustand setter and toasted success; `saveSettings` in
 * storage.ts had zero call sites and there was no backend settings module, so the
 * company name and logo an administrator set were gone on the next reload, on
 * values printed at the top of every report.
 */

/**
 * The catalogue keys this screen knows about, and how the form field maps onto them.
 *
 * `editable: false` means the key is still read — other screens consume it — but
 * this form has no input for it, so it must never be written from here. A key that
 * is read-only here is not dead config: `defaultUnloadingDuration` and
 * `defaultDelayPenalty` are the fallbacks the daily-operations screen and the
 * statement use when no unloading rule matches.
 */
type FieldBinding = {
  settingKey: string;
  field: keyof SystemSettings;
  label: string;
  type: 'string' | 'number';
  editable: boolean;
  /** A value the server refuses to blank, because it is printed on every document. */
  required?: boolean;
};

const BINDINGS: FieldBinding[] = [
  { settingKey: 'company.name', field: 'companyName', label: 'اسم الشركة', type: 'string', editable: true, required: true },
  { settingKey: 'company.address', field: 'address', label: 'العنوان', type: 'string', editable: true },
  { settingKey: 'company.phone', field: 'phone', label: 'الهاتف', type: 'string', editable: true },
  { settingKey: 'company.logoUrl', field: 'logoUrl', label: 'رابط الشعار', type: 'string', editable: true },
  { settingKey: 'company.currency', field: 'currency', label: 'العملة', type: 'string', editable: true, required: true },
  { settingKey: 'operations.defaultUnloadingDuration', field: 'defaultUnloadingDuration', label: 'مدة التفريغ الافتراضية (دقيقة)', type: 'number', editable: false },
  { settingKey: 'operations.defaultDelayPenalty', field: 'defaultDelayPenalty', label: 'غرامة التأخير الافتراضية', type: 'number', editable: false },
];

const EDITABLE_BINDINGS = BINDINGS.filter((binding) => binding.editable);

const serverValueToForm = (settings: Record<string, any>): Partial<SystemSettings> => {
  const out: Record<string, unknown> = {};
  for (const binding of BINDINGS) {
    const setting = settings?.[binding.settingKey];
    if (setting === undefined || setting === null) continue;
    out[binding.field] = binding.type === 'number' ? Number(setting.value) : String(setting.value);
  }
  return out as Partial<SystemSettings>;
};

/**
 * Only the editable keys are sent.
 *
 * Sending every binding would write the read-only numeric defaults as 0 — the form
 * has no input to refill them, so an operator editing the phone number would quietly
 * reset the unloading duration to 0 in the same request.
 */
const formToServer = (form: SystemSettings, reason?: string) => ({
  reason,
  settings: EDITABLE_BINDINGS.map((binding) => {
    const raw = form[binding.field];
    return {
      key: binding.settingKey,
      // An empty numeric field is not 0. `Number('')` is 0 and `Number('-')` is
      // NaN, and NaN ?? 60 is NaN — which is how a stray minus sign reached the
      // unloading rules as a real, wrong duration.
      value: binding.type === 'number' ? (raw === null || raw === undefined || raw === ('' as any) ? 0 : Number(raw)) : String(raw ?? ''),
    };
  }),
});

export const loadSystemSettings = async (): Promise<Partial<SystemSettings>> => {
  const { data } = await apiClient.get('/system-settings');
  return serverValueToForm(data?.settings ?? {});
};

export const saveSystemSettings = async (
  form: SystemSettings,
  reason?: string,
): Promise<{ changed: string[]; settings: Record<string, any> }> => {
  // A numeric field the operator left mid-edit must not be written as 0 without
  // being told. Reject here rather than letting the server store a wrong number.
  for (const binding of EDITABLE_BINDINGS.filter((entry) => entry.type === 'number')) {
    const raw = form[binding.field];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'number' && !Number.isFinite(raw)) {
      throw new Error(`${binding.label}: القيمة يجب أن تكون رقمًا صحيحًا.`);
    }
  }

  // The company name and the currency are printed on every stock card, statement
  // and operations print. Blanking one is not a cosmetic mistake, so it is refused
  // here with the field named, instead of at the server as a bare 400.
  for (const binding of EDITABLE_BINDINGS.filter((entry) => entry.required)) {
    const raw = String(form[binding.field] ?? '').trim();
    if (!raw) {
      throw new Error(`${binding.label}: هذا الحقل مطلوب ولا يمكن تركه فارغًا.`);
    }
  }

  const { data } = await apiClient.put('/system-settings', formToServer(form, reason));
  if (!data) {
    throw new Error('لم يصل ردّ من الخادم بعد الحفظ.');
  }
  return { changed: data.changed ?? [], settings: data.settings ?? {} };
};

export const reportSettingsSave = (changed: string[]) => {
  if (!changed.length) {
    toast.success('لا توجد تغييرات لحفظها.');
    return;
  }
  toast.success(`تم حفظ ${changed.length} إعداد بنجاح.`);
};
