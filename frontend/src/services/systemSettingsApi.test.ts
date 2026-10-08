import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/client', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));
vi.mock('@services/toastService', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import apiClient from '@api/client';
import {
  BINDINGS,
  EDITABLE_BINDINGS,
  loadSystemSettings,
  reportSettingsSave,
  saveSystemSettings,
  validateSettingsForm,
  type ServerSetting,
} from './systemSettingsApi';
import type { SystemSettings } from '../types';

const getMock = vi.mocked(apiClient.get);
const putMock = vi.mocked(apiClient.put);

/**
 * Captured verbatim from `GET /system-settings` against the running server.
 *
 * `settings` is an **array**. This fixture is the whole reason the settings screen did
 * nothing: the reader indexed it as an object, so `settings['company.name']` was
 * `undefined` for every key, the load returned `{}`, the form kept the empty client-side
 * defaults, and the required-field guard then refused the save before a request was sent.
 */
const LIVE_RESPONSE = {
  settings: [
    {
      key: 'company.name', label: 'اسم الشركة', category: 'company', valueType: 'string',
      defaultValue: '', required: true, value: 'السهل الأخضر للمطاحن و الأعلاف',
      updatedAt: '2026-10-06T15:53:00.796Z', updatedById: '4ec96477', reason: null, isDefault: false,
    },
    {
      key: 'company.address', label: 'العنوان', category: 'company', valueType: 'string',
      defaultValue: '', value: 'سيدي السائح', updatedAt: '2026-10-06T15:53:00.798Z',
      updatedById: '4ec96477', reason: null, isDefault: false,
    },
    {
      key: 'company.currency', label: 'العملة', category: 'company', valueType: 'string',
      defaultValue: 'EGP', required: true, value: 'د.ل', updatedAt: '2026-10-06T15:53:00.799Z',
      updatedById: '4ec96477', reason: null, isDefault: false,
    },
    {
      key: 'company.phone', label: 'الهاتف', category: 'company', valueType: 'string',
      defaultValue: '', value: '', updatedAt: null, updatedById: null, reason: null, isDefault: true,
    },
    {
      key: 'operations.defaultUnloadingDuration', label: 'مدة التفريغ', category: 'operations',
      valueType: 'number', defaultValue: 60, value: 60, updatedAt: null, reason: null, isDefault: true,
    },
  ],
};

const serverSetting = (over: Partial<ServerSetting> = {}): ServerSetting => ({
  key: 'company.name', value: 'ش', valueType: 'string', ...over,
});

describe('loadSystemSettings — the shape the server actually returns', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the array shape, which is the one that broke the screen', async () => {
    getMock.mockResolvedValue({ data: LIVE_RESPONSE } as never);
    const { form, meta } = await loadSystemSettings();

    expect(form.companyName).toBe('السهل الأخضر للمطاحن و الأعلاف');
    expect(form.address).toBe('سيدي السائح');
    expect(form.currency).toBe('د.ل');
    expect(form.defaultUnloadingDuration).toBe(60);
    expect(meta.companyName.isDefault).toBe(false);
    expect(meta.companyName.updatedAt).toBe('2026-10-06T15:53:00.796Z');
    expect(meta.phone.isDefault).toBe(true);
  });

  it('reads a keyed-object shape too, so a future change cannot blank the screen', async () => {
    const asMap = Object.fromEntries((LIVE_RESPONSE.settings as ServerSetting[]).map((s) => [s.key, s]));
    getMock.mockResolvedValue({ data: { settings: asMap } } as never);
    const { form } = await loadSystemSettings();
    expect(form.companyName).toBe('السهل الأخضر للمطاحن و الأعلاف');
  });

  it('fails loudly on a shape it does not know', async () => {
    // The defect survived because the reader returned `{}` for anything it could not
    // parse, which looks identical to "the settings are empty". A contract change must
    // arrive as an error, never as a blank form.
    getMock.mockResolvedValue({ data: { settings: 'nope' } } as never);
    await expect(loadSystemSettings()).rejects.toThrow(/SETTINGS_SHAPE_UNRECOGNISED/);
    getMock.mockResolvedValue({ data: null } as never);
    await expect(loadSystemSettings()).rejects.toThrow(/SETTINGS_SHAPE_UNRECOGNISED/);
  });

  it('leaves a field alone when the server has never heard of its key', async () => {
    getMock.mockResolvedValue({ data: { settings: [serverSetting()] } } as never);
    const { form } = await loadSystemSettings();
    // Absent is normal, not an instruction to blank a value the operator already had.
    expect(form.companyName).toBe('ش');
    expect(form.address).toBeUndefined();
  });

  it('falls back to the declared default for a number the server could not parse', async () => {
    getMock.mockResolvedValue({
      data: { settings: [serverSetting({ key: 'operations.defaultUnloadingDuration', valueType: 'number', value: 'not-a-number', defaultValue: 60 })] },
    } as never);
    const { form } = await loadSystemSettings();
    expect(form.defaultUnloadingDuration).toBe(60);
  });
});

describe('validateSettingsForm', () => {
  const good: SystemSettings = { companyName: 'شركة', currency: 'ج.ل', address: 'عنوان', phone: '' };

  it('accepts a complete form', () => {
    expect(validateSettingsForm(good)).toEqual([]);
  });

  it('names the blank required field instead of saying "invalid form"', () => {
    const issues = validateSettingsForm({ ...good, companyName: '   ' });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('companyName');
    expect(issues[0].message).toContain('اسم الشركة');
  });

  it('requires the currency too', () => {
    expect(validateSettingsForm({ ...good, currency: '' }).map((i) => i.field)).toEqual(['currency']);
  });

  it('refuses a logo that is not http(s)', () => {
    const bad = validateSettingsForm({ ...good, logoUrl: 'javascript:alert(1)' });
    expect(bad[0]?.field).toBe('logoUrl');
    expect(validateSettingsForm({ ...good, logoUrl: 'https://cdn.example/logo.png' })).toEqual([]);
    expect(validateSettingsForm({ ...good, logoUrl: '' })).toEqual([]);
  });

  it('refuses a logo that is not a URL at all', () => {
    expect(validateSettingsForm({ ...good, logoUrl: 'شعار الشركة' })[0]?.field).toBe('logoUrl');
  });

  it('leaves the read-only numeric defaults to the server, because this form cannot set them', () => {
    // No editable binding is a number, so there is no input here that could produce a
    // bad one. Validating them would be a rule nothing could ever trigger — and asserting
    // the opposite is how a test starts demanding behaviour the product does not have.
    expect(EDITABLE_BINDINGS.every((binding) => binding.type !== 'number')).toBe(true);
    expect(validateSettingsForm({ ...good, defaultUnloadingDuration: -1 })).toEqual([]);
    expect(validateSettingsForm({ ...good, defaultUnloadingDuration: NaN })).toEqual([]);
  });

  it('caps the length of a field that is printed on documents', () => {
    expect(validateSettingsForm({ ...good, companyName: 'ا'.repeat(121) })[0]?.message).toContain('120');
  });
});

describe('saveSystemSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never sends a request when the form is invalid', async () => {
    await expect(
      saveSystemSettings({ companyName: '', currency: 'ج.ل', address: '', phone: '' }, {}),
    ).rejects.toThrow();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('sends only the editable bindings, so a read-only default is not zeroed', async () => {
    putMock.mockResolvedValue({ data: { changed: [], settings: LIVE_RESPONSE.settings } } as never);
    await saveSystemSettings(
      { companyName: 'شركة', currency: 'ج.ل', address: 'عنوان', phone: '010' },
      { defaultUnloadingDuration: { updatedAt: '2026-01-01T00:00:00.000Z' } as never },
    );
    const body = putMock.mock.calls[0][1] as { settings: Array<{ key: string }> };
    // The defect this guards: with no input on the form, `undefined` became 0 and an
    // operator editing the phone number reset the unloading duration in the same request.
    expect(body.settings.map((s) => s.key)).not.toContain('operations.defaultUnloadingDuration');
    expect(body.settings.map((s) => s.key)).toEqual(EDITABLE_BINDINGS.map((b) => b.settingKey));
  });

  it('sends the version it read, so a concurrent save is refused rather than overwritten', async () => {
    putMock.mockResolvedValue({ data: { changed: [], settings: LIVE_RESPONSE.settings } } as never);
    await saveSystemSettings(
      { companyName: 'شركة', currency: 'ج.ل', address: '', phone: '' },
      { companyName: { key: 'company.name', label: 'اسم الشركة', isDefault: false, updatedAt: '2026-10-06T15:53:00.796Z', updatedById: null, reason: null } },
    );
    const body = putMock.mock.calls[0][1] as { settings: Array<{ key: string; expectedUpdatedAt?: string }> };
    expect(body.settings.find((s) => s.key === 'company.name')?.expectedUpdatedAt).toBe('2026-10-06T15:53:00.796Z');
  });

  it('carries the operator reason and returns the server snapshot', async () => {
    putMock.mockResolvedValue({ data: { changed: ['company.name'], settings: LIVE_RESPONSE.settings } } as never);
    const result = await saveSystemSettings(
      { companyName: 'شركة', currency: 'ج.ل', address: '', phone: '' },
      {},
      'تغيير المالك',
    );
    const body = putMock.mock.calls[0][1] as { reason?: string };
    expect(body.reason).toBe('تغيير المالك');
    expect(result.changed).toEqual(['company.name']);
    expect(result.snapshot.form.companyName).toBe('السهل الأخضر للمطاحن و الأعلاف');
  });

  it('treats an empty response as a failure rather than a success', async () => {
    putMock.mockResolvedValue({ data: null } as never);
    await expect(
      saveSystemSettings({ companyName: 'شركة', currency: 'ج.ل', address: '', phone: '' }, {}),
    ).rejects.toThrow(/لم يصل ردّ/);
  });
});

describe('reportSettingsSave', () => {
  it('does not present "nothing changed" as a success', async () => {
    const { toast } = await import('@services/toastService');
    reportSettingsSave([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('لم تتغيّر'));
  });

  it('names the fields that moved', async () => {
    const { toast } = await import('@services/toastService');
    reportSettingsSave(['company.name', 'company.phone']);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('اسم الشركة'));
  });
});

describe('the bindings and the catalogue', () => {
  it('declares no duplicate setting keys', () => {
    const keys = BINDINGS.map((b) => b.settingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares no duplicate form fields', () => {
    const fields = BINDINGS.map((b) => b.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('marks a required binding only where the server also requires it', async () => {
    // Both sides must agree, or the screen blocks a save the server would have taken,
    // or accepts one the server will refuse as a bare 400.
    getMock.mockResolvedValue({ data: LIVE_RESPONSE } as never);
    const { meta } = await loadSystemSettings();
    for (const binding of BINDINGS) {
      const server = (LIVE_RESPONSE.settings as ServerSetting[]).find((s) => s.key === binding.settingKey);
      if (!server) continue;
      expect(Boolean(binding.required)).toBe(Boolean(server.required));
      expect(meta[binding.field].isDefault).toBe(server.isDefault);
    }
  });
});