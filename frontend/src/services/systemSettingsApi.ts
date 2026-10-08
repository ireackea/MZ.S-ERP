import { toast } from '@services/toastService';
import apiClient from '@api/client';
import type { SystemSettings } from '../types';

/**
 * The settings screen's only path to the server, and the contract between the
 * catalogue in the backend and the fields on this form.
 *
 * Gate 2.1 / 3.4 — the screen used to write into a Zustand store and nowhere else:
 * `saveSettings` in storage.ts had zero call sites and there was no backend settings
 * module, so the company name an administrator set was gone on the next reload, on a
 * value printed at the top of every report.
 *
 * Then it was given a server and still did nothing, for a quieter reason. `getAll`
 * returns `settings` as an **array** of resolved definitions; this module indexed it as
 * an object (`settings['company.name']`), which is `undefined` on an array for every
 * key. So the load returned `{}`, the form kept the empty client-side defaults, and the
 * required-field guard then refused the save before a request was ever sent. The stored
 * company name was in the database the whole time and no screen could read it.
 *
 * The lesson is written into `parseSettingsPayload` below: both shapes are accepted and
 * normalised, and anything else is a hard error. A parser that picks one shape and hopes
 * is what turned a two-line contract drift into an unusable screen.
 */

export type SettingValueType = 'string' | 'number' | 'boolean';

/** One resolved setting, as `SystemSettingsService.getAll` returns it. */
export type ServerSetting = {
  key: string;
  label?: string;
  category?: string;
  valueType?: SettingValueType;
  defaultValue?: unknown;
  required?: boolean;
  value: unknown;
  updatedAt?: string | null;
  updatedById?: string | null;
  reason?: string | null;
  isDefault?: boolean;
};

/** What the screen needs to say about a field beyond its value. */
export type FieldMeta = {
  key: string;
  label: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedById: string | null;
  reason: string | null;
};

export type SettingsSnapshot = {
  form: Partial<SystemSettings>;
  meta: Record<string, FieldMeta>;
};

export type FieldBinding = {
  settingKey: string;
  field: keyof SystemSettings;
  label: string;
  type: 'string' | 'number';
  editable: boolean;
  /** A value the server refuses to blank, because it is printed on every document. */
  required?: boolean;
  /** Schemes accepted for a URL field. Empty is always allowed. */
  schemes?: readonly string[];
  maxLength?: number;
};

/**
 * The catalogue keys this screen knows about, and how each form field maps onto them.
 *
 * `editable: false` means the key is still read — other screens consume it — but this
 * form has no input for it, so it must never be written from here. `defaultUnloadingDuration`
 * and `defaultDelayPenalty` are the fallbacks the daily-operations screen and the statement
 * use when no unloading rule matches; they are owned by «الأقسام ووحدات القياس».
 *
 * Every editable key in `SETTING_CATALOGUE` must appear here, and
 * `systemSettingsApi.test.ts` fails the build when the two lists drift apart.
 */
export const BINDINGS: readonly FieldBinding[] = [
  { settingKey: 'company.name', field: 'companyName', label: 'اسم الشركة', type: 'string', editable: true, required: true, maxLength: 120 },
  { settingKey: 'company.currency', field: 'currency', label: 'العملة', type: 'string', editable: true, required: true, maxLength: 16 },
  { settingKey: 'company.address', field: 'address', label: 'العنوان', type: 'string', editable: true, maxLength: 240 },
  { settingKey: 'company.phone', field: 'phone', label: 'الهاتف', type: 'string', editable: true, maxLength: 40 },
  { settingKey: 'company.email', field: 'email', label: 'البريد الإلكتروني', type: 'string', editable: true, maxLength: 120 },
  { settingKey: 'company.taxId', field: 'taxId', label: 'الرقم الضريبي', type: 'string', editable: true, maxLength: 40 },
  {
    settingKey: 'company.logoUrl',
    field: 'logoUrl',
    label: 'رابط الشعار',
    type: 'string',
    editable: true,
    maxLength: 500,
    // A logo is fetched by the browser and painted into an `<img>`. `javascript:` in an
    // `img src` is inert in current browsers, but the allow-list is here so the value
    // that reaches a document header is one the site can actually load, and so a
    // `data:`-or-`file:` value cannot be stored by accident and surprise a later renderer.
    schemes: ['http', 'https'],
  },
  { settingKey: 'operations.defaultUnloadingDuration', field: 'defaultUnloadingDuration', label: 'مدة التفريغ الافتراضية (دقيقة)', type: 'number', editable: false },
  { settingKey: 'operations.defaultDelayPenalty', field: 'defaultDelayPenalty', label: 'غرامة التأخير الافتراضية', type: 'number', editable: false },
];

export const EDITABLE_BINDINGS = BINDINGS.filter((binding) => binding.editable);

/** The server's answer, in either of the two shapes it has used. */
const parseSettingsPayload = (payload: unknown): ServerSetting[] => {
  const raw = (payload as { settings?: unknown } | null | undefined)?.settings;

  // The shape the backend returns today.
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry): entry is ServerSetting =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as ServerSetting).key === 'string',
    );
  }

  // The shape a keyed object would take, accepted so that a future change on the server
  // cannot silently blank this screen the way the array/object mismatch did.
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([key, entry]) => {
        const value = entry && typeof entry === 'object' && 'value' in (entry as object)
          ? (entry as { value: unknown })
          : { value: entry };
        return { key, ...value } as ServerSetting;
      })
      .filter((entry) => typeof entry.key === 'string');
  }

  // Anything else is a contract change this module does not know about. Failing here is
  // the whole point: an empty form with no error is how this defect stayed invisible.
  throw new Error(
    'SETTINGS_SHAPE_UNRECOGNISED: لم يصل ردّ إعدادات بالشكل المعروف (قائمة أو كائن مُفهرس بالمفتاح).',
  );
};

const toFormValue = (binding: FieldBinding, setting: ServerSetting): string | number => {
  const raw = setting.value;
  if (binding.type === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : Number(setting.defaultValue ?? 0) || 0;
  }
  return raw === null || raw === undefined ? String(setting.defaultValue ?? '') : String(raw);
};

const buildSnapshot = (settings: ServerSetting[]): SettingsSnapshot => {
  const byKey = new Map(settings.map((entry) => [entry.key, entry]));
  const form: Record<string, string | number> = {};
  const meta: Record<string, FieldMeta> = {};

  for (const binding of BINDINGS) {
    const setting = byKey.get(binding.settingKey);
    meta[binding.field] = {
      key: binding.settingKey,
      label: String(setting?.label ?? binding.label),
      isDefault: setting ? setting.isDefault !== false : true,
      updatedAt: setting?.updatedAt ?? null,
      updatedById: setting?.updatedById ?? null,
      reason: setting?.reason ?? null,
    };
    // Absent is normal for a key the server has never been given a value for, so the
    // field is left as the form found it rather than blanked.
    if (setting === undefined) continue;
    form[binding.field] = toFormValue(binding, setting);
  }

  return { form: form as Partial<SystemSettings>, meta };
};

/** Reads the settings and everything the screen needs to talk about them. */
export const loadSystemSettings = async (): Promise<SettingsSnapshot> => {
  const { data } = await apiClient.get('/system-settings');
  return buildSnapshot(parseSettingsPayload(data));
};

/**
 * The flat form only, for the places that just need the values — chiefly the store, so
 * that a report prints the company it actually belongs to.
 */
export const loadSystemSettingsForm = async (): Promise<Partial<SystemSettings>> =>
  (await loadSystemSettings()).form;

export type FieldIssue = { field: keyof SystemSettings; message: string };

const isBlank = (value: unknown) => String(value ?? '').trim() === '';

/**
 * Per-field problems, keyed by field so the message can sit under the input instead of
 * arriving as a toast the operator has to remember.
 *
 * Three rules only, and every one of them is a rule the server also enforces: a required
 * field may not be blank, a text field has a length the documents can carry, and a URL is
 * one the browser can load. Numbers are deliberately absent — the only numeric bindings
 * are read-only (`editable: false`), so this form has no input that could produce a bad
 * one, and `formToServer`'s conversion plus `SystemSettingsService.validateValue` are the
 * authority. A rule that cannot fire here would be a rule nothing tests.
 */
export const validateSettingsForm = (form: Partial<SystemSettings>): FieldIssue[] => {
  const issues: FieldIssue[] = [];

  for (const binding of EDITABLE_BINDINGS) {
    const raw = form[binding.field];

    if (binding.required && isBlank(raw)) {
      issues.push({ field: binding.field, message: `${binding.label}: هذا الحقل مطلوب ولا يمكن تركه فارغًا.` });
      continue;
    }

    if (isBlank(raw)) continue;

    const text = String(raw).trim();

    if (binding.maxLength && text.length > binding.maxLength) {
      issues.push({ field: binding.field, message: `${binding.label}: الحد الأقصى ${binding.maxLength} حرفًا.` });
      continue;
    }

    if (binding.schemes) {
      let scheme = '';
      try {
        scheme = new URL(text).protocol.replace(/:$/, '').toLowerCase();
      } catch {
        issues.push({ field: binding.field, message: `${binding.label}: الرابط غير صالح.` });
        continue;
      }
      if (!binding.schemes.includes(scheme)) {
        issues.push({
          field: binding.field,
          message: `${binding.label}: المسموح ${binding.schemes.map((entry) => `${entry}://`).join(' أو ')} فقط.`,
        });
      }
    }
  }

  return issues;
};

/**
 * Only the editable keys are sent.
 *
 * Sending every binding would write the read-only numeric defaults as 0 — the form has
 * no input to refill them, so an operator editing the phone number would quietly reset
 * the unloading duration to 0 in the same request.
 */
const formToServer = (
  form: SystemSettings,
  meta: Record<string, FieldMeta>,
  reason?: string,
) => ({
  reason: String(reason ?? '').trim() || undefined,
  settings: EDITABLE_BINDINGS.map((binding) => {
    const raw = form[binding.field];
    // An empty numeric field is not 0. `Number('')` is 0 and `Number('-')` is NaN, and
    // NaN ?? 60 is NaN — which is how a stray minus sign reached the unloading rules as
    // a real, wrong duration.
    const value = binding.type === 'number'
      ? (raw === null || raw === undefined || raw === ('' as unknown) ? 0 : Number(raw))
      : String(raw ?? '');
    return {
      key: binding.settingKey,
      value,
      // Last-write-wins is how one administrator silently undoes another's company name.
      // The server compares this and refuses the write when someone got there first.
      expectedUpdatedAt: meta[binding.field]?.updatedAt ?? undefined,
    };
  }),
});

export type SaveSettingsResult = { changed: string[]; snapshot: SettingsSnapshot };

export const saveSystemSettings = async (
  form: SystemSettings,
  meta: Record<string, FieldMeta>,
  reason?: string,
): Promise<SaveSettingsResult> => {
  const issues = validateSettingsForm(form);
  if (issues.length) {
    // Thrown, not returned, so a caller that forgets to check cannot report success.
    throw new Error(issues[0].message);
  }

  const { data } = await apiClient.put('/system-settings', formToServer(form, meta, reason));
  if (!data) {
    throw new Error('لم يصل ردّ من الخادم بعد الحفظ.');
  }
  return {
    changed: Array.isArray(data.changed) ? data.changed : [],
    snapshot: buildSnapshot(parseSettingsPayload(data)),
  };
};

/**
 * What to tell the operator after a save.
 *
 * "Nothing changed" is not a success and is not a failure, so it no longer wears the
 * success styling — and the wording says which fields moved, because a count alone does
 * not tell an operator whether the company name or the phone number was written.
 */
export const reportSettingsSave = (changed: string[]) => {
  if (!changed.length) {
    toast.info('لم تتغيّر أي قيمة. لم يُكتب شيء.');
    return;
  }
  const labels = changed.map((key) => BINDINGS.find((binding) => binding.settingKey === key)?.label ?? key);
  toast.success(`تم حفظ ${labels.length} إعداد: ${labels.join('، ')}`);
};