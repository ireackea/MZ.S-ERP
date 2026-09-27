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

/** The catalogue keys this screen edits, and how the form field maps onto them. */
type FieldBinding = {
  settingKey: string;
  field: keyof SystemSettings;
  type: 'string' | 'number';
};

const BINDINGS: FieldBinding[] = [
  { settingKey: 'company.name', field: 'companyName', type: 'string' },
  { settingKey: 'company.address', field: 'address', type: 'string' },
  { settingKey: 'company.phone', field: 'phone', type: 'string' },
  { settingKey: 'company.logoUrl', field: 'logoUrl', type: 'string' },
  { settingKey: 'company.currency', field: 'currency', type: 'string' },
  { settingKey: 'operations.defaultUnloadingDuration', field: 'defaultUnloadingDuration', type: 'number' },
  { settingKey: 'operations.defaultDelayPenalty', field: 'defaultDelayPenalty', type: 'number' },
];

const serverValueToForm = (settings: Record<string, any>): Partial<SystemSettings> => {
  const out: Record<string, unknown> = {};
  for (const binding of BINDINGS) {
    const setting = settings?.[binding.settingKey];
    if (setting === undefined || setting === null) continue;
    out[binding.field] = binding.type === 'number' ? Number(setting.value) : String(setting.value);
  }
  return out as Partial<SystemSettings>;
};

const formToServer = (form: SystemSettings, reason?: string) => ({
  reason,
  settings: BINDINGS.map((binding) => {
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
  for (const binding of BINDINGS.filter((entry) => entry.type === 'number')) {
    const raw = form[binding.field];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'number' && !Number.isFinite(raw)) {
      throw new Error(`${binding.settingKey}: القيمة يجب أن تكون رقمًا صحيحًا.`);
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
