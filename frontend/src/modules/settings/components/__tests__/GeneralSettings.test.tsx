import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
  reportSettingsSave: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@services/toastService', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@services/systemSettingsApi', async () => {
  const actual = await vi.importActual<typeof import('@services/systemSettingsApi')>('@services/systemSettingsApi');
  return {
    ...actual,
    loadSystemSettings: mocks.loadSystemSettings,
    saveSystemSettings: mocks.saveSystemSettings,
    reportSettingsSave: mocks.reportSettingsSave,
  };
});

import GeneralSettings from '../GeneralSettings';
import type { SystemSettings } from '../../../../types';

const emptyProps: SystemSettings = { companyName: '', currency: '', address: '', phone: '' };

const snapshot = (over: Partial<SystemSettings> = {}) => ({
  form: {
    companyName: 'السهل الأخضر للمطاحن و الأعلاف',
    address: 'سيدي السائح',
    currency: 'د.ل',
    phone: '',
    ...over,
  },
  meta: {
    companyName: { key: 'company.name', label: 'اسم الشركة', isDefault: false, updatedAt: '2026-10-06T15:53:00.796Z', updatedById: 'u1', reason: null },
    address: { key: 'company.address', label: 'العنوان', isDefault: false, updatedAt: '2026-10-06T15:53:00.798Z', updatedById: 'u1', reason: null },
    currency: { key: 'company.currency', label: 'العملة', isDefault: false, updatedAt: '2026-10-06T15:53:00.799Z', updatedById: 'u1', reason: null },
    phone: { key: 'company.phone', label: 'الهاتف', isDefault: true, updatedAt: null, updatedById: null, reason: null },
  },
});

const setup = (over: Partial<React.ComponentProps<typeof GeneralSettings>> = {}) =>
  render(<GeneralSettings settings={emptyProps} onUpdateSettings={vi.fn()} {...over} />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.loadSystemSettings.mockResolvedValue(snapshot());
  mocks.saveSystemSettings.mockResolvedValue({ changed: ['company.name'], snapshot: snapshot() });
});

describe('GeneralSettings', () => {
  it('opens on the values the server holds, not on the empty client defaults', async () => {
    setup();
    expect(await screen.findByDisplayValue('السهل الأخضر للمطاحن و الأعلاف')).toBeInTheDocument();
    expect(screen.getByDisplayValue('سيدي السائح')).toBeInTheDocument();
    expect(screen.getByDisplayValue('د.ل')).toBeInTheDocument();
  });

  it('says which fields were never edited, so a default is not read as a saved value', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText(/لم تُعدَّل بعد/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/آخر تعديل:/).length).toBeGreaterThan(0);
  });

  it('keeps saving disabled until something actually changes', async () => {
    setup();
    const button = await screen.findByRole('button', { name: /حفظ الإعدادات العامة/ });
    await waitFor(() => expect(button).toBeDisabled());

    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('marks the form as having unsaved changes', async () => {
    setup();
    await screen.findByDisplayValue('د.ل');
    expect(screen.queryByText(/توجد تغييرات غير محفوظة/)).toBeNull();
    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    expect(await screen.findByText(/توجود تغييرات غير محفوظة|توجد تغييرات غير محفوظة/)).toBeInTheDocument();
  });

  it('refuses to save while the read failed, rather than overwriting stored values with defaults', async () => {
    mocks.loadSystemSettings.mockRejectedValue(new Error('الخادم غير متاح'));
    setup();

    expect(await screen.findByText(/تعذّر قراءة الإعدادات المحفوظة/)).toBeInTheDocument();
    // The operator is told the fields may be showing defaults, not the stored values.
    expect(screen.getByText(/قد تعرض قيمًا افتراضية/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ })).toBeDisabled();
    expect(mocks.saveSystemSettings).not.toHaveBeenCalled();
  });

  it('offers a re-read after a failure', async () => {
    mocks.loadSystemSettings.mockRejectedValueOnce(new Error('الخادم غير متاح'));
    setup();
    await screen.findByText(/تعذّر قراءة الإعدادات المحفوظة/);

    mocks.loadSystemSettings.mockResolvedValue(snapshot());
    fireEvent.click(screen.getByRole('button', { name: /إعادة القراءة/ }));
    expect(await screen.findByDisplayValue('السهل الأخضر للمطاحن و الأعلاف')).toBeInTheDocument();
  });

  it('shows a validation message under the field, not only as a toast', async () => {
    setup();
    await screen.findByDisplayValue('د.ل');
    const button = screen.getByRole('button', { name: /حفظ الإعدادات العامة/ });

    // Blank the company name, then try to save.
    const nameInput = screen.getByDisplayValue('السهل الأخضر للمطاحن و الأعلاف');
    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/اسم الشركة: هذا الحقل مطلوب/)).toBeInTheDocument();
    expect(mocks.saveSystemSettings).not.toHaveBeenCalled();
  });

  it('does not let a server value overwrite what was typed while the load was in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.loadSystemSettings.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    setup();
    // Typed before the server answered — the exact window in which the old merge threw
    // the operator's keystrokes away without a word.
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'اسم كتبه المستخدم' } });

    release(snapshot());
    await screen.findByText(/وصلت القيم المحفوظة بعد أن بدأت الكتابة/);
    expect(screen.getByDisplayValue('اسم كتبه المستخدم')).toBeInTheDocument();
  });

  it('says a concurrent save was refused instead of overwriting it', async () => {
    const conflict = Object.assign(new Error('عدّلها مستخدم آخر'), {
      response: { status: 409, data: { message: 'اسم الشركة: عدّلها مستخدم آخر بعد أن فتحت الشاشة.' } },
    });
    mocks.saveSystemSettings.mockRejectedValue(conflict);
    setup();
    await screen.findByDisplayValue('د.ل');

    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ }));

    expect(await screen.findByText(/عدّلها مستخدم آخر/)).toBeInTheDocument();
  });

  it('passes the operator reason and the version it read to the server', async () => {
    setup();
    await screen.findByDisplayValue('د.ل');
    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    fireEvent.change(screen.getByPlaceholderText(/تغيير المالك/), { target: { value: 'تحديث الاسم' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ }));

    await waitFor(() => expect(mocks.saveSystemSettings).toHaveBeenCalled());
    expect(mocks.saveSystemSettings.mock.calls[0][2]).toBe('تحديث الاسم');
    expect(mocks.saveSystemSettings.mock.calls[0][1].companyName.updatedAt).toBe('2026-10-06T15:53:00.796Z');
  });

  it('reports what the server changed and refreshes the form from its answer', async () => {
    const onUpdate = vi.fn();
    mocks.saveSystemSettings.mockResolvedValue({
      changed: ['company.name'],
      snapshot: snapshot({ companyName: 'الاسم الجديد', currency: 'ج.م' }),
    });
    render(<GeneralSettings settings={emptyProps} onUpdateSettings={onUpdate} />);
    await screen.findByDisplayValue('د.ل');

    fireEvent.change(screen.getByDisplayValue('السهل الأخضر للمطاحن و الأعلاف'), { target: { value: 'الاسم الجديد' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ }));

    await waitFor(() => expect(mocks.reportSettingsSave).toHaveBeenCalledWith(['company.name']));
    expect(await screen.findByDisplayValue('الاسم الجديد')).toBeInTheDocument();
    // The store is what report headers read, so it is fed the server's values.
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'الاسم الجديد', currency: 'ج.م' }));
  });

  it('offers the read-only operations defaults nowhere on this form', async () => {
    setup();
    await screen.findByDisplayValue('د.ل');
    expect(screen.queryByText(/مدة التفريغ الافتراضية/)).toBeNull();
    expect(screen.queryByText(/غرامة التأخير الافتراضية/)).toBeNull();
  });

  it('offers the fields that exist in the catalogue and had no input before', async () => {
    setup();
    await screen.findByDisplayValue('د.ل');
    expect(screen.getByLabelText(/البريد الإلكتروني/)).toBeInTheDocument();
    expect(screen.getByLabelText(/الرقم الضريبي/)).toBeInTheDocument();
  });
});
/**
 * Gate 4.9 — a write conflict was dressed as a read failure.
 *
 * `loadError` was one state for two unrelated events. A 409 — somebody else saved
 * while this screen was open — set it, and the banner it drives says "the fields
 * below may show default values and not the saved ones" and disables Save forever
 * until a re-read. Both are false: the read succeeded, those are the stored values
 * plus what the operator typed, and the only exit was a re-read that threw their
 * edits away.
 *
 * It fails safe — the concurrent write is never overwritten — so this is about the
 * screen lying about its own state, not about data being lost silently.
 */
describe('a write conflict is not reported as a read failure', () => {
  const conflict409 = () => {
    const conflict = Object.assign(new Error('عدّلها مستخدم آخر'), {
      response: { status: 409, data: { message: 'اسم الشركة: عدّلها مستخدم آخر بعد أن فتحت الشاشة.' } },
    });
    mocks.saveSystemSettings.mockRejectedValue(conflict);
  };

  it('names the conflict without claiming the fields may be defaults', async () => {
    conflict409();
    setup();
    await screen.findByDisplayValue('د.ل');

    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ }));

    expect(await screen.findByText(/عدّلها مستخدم آخر/)).toBeInTheDocument();
    expect(screen.queryByText(/تعذّر قراءة الإعدادات المحفوظة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/قد تعرض قيمًا افتراضية/)).not.toBeInTheDocument();
  });

  it('offers a way to keep the edits instead of forcing a re-read', async () => {
    conflict409();
    setup();
    await screen.findByDisplayValue('د.ل');

    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ }));

    expect(await screen.findByText(/عدّلها مستخدم آخر/)).toBeInTheDocument();
    // The operator's own value is still in the field, so the screen must not imply
    // that it is gone.
    expect(screen.getByDisplayValue('ج.م')).toBeInTheDocument();
  });
});
/**
 * Gate 4.10 — leaving by tab switch threw the edits away silently.
 *
 * The screen guarded `beforeunload` and nothing else, but these panels are unmounted
 * by a tab switch inside a single-page app. So the one exit that had no confirmation
 * of its own was the one nobody was guarding: type a company name, open another tab,
 * come back, and it is gone with no message at any point.
 */
describe('the form tells the tab owner when it is dirty', () => {
  it('reports dirty when the operator types and clean again after a save', async () => {
    const onDirtyChange = vi.fn();
    const done = setup({ onDirtyChange });
    await screen.findByDisplayValue('د.ل');

    fireEvent.change(screen.getByDisplayValue('د.ل'), { target: { value: 'ج.م' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByRole('button', { name: /حفظ الإعدادات العامة/ }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    done.unmount();
  });
});