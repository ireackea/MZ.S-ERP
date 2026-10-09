import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  permissions: [] as string[],
}));

vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission, permissions: mocks.permissions }),
}));

// The tabs are lazily loaded; a stub is enough because this spec is about which tabs
// exist, not what they render.
vi.mock('../components/GeneralSettings', () => ({ default: () => <div data-testid="tab-general" /> }));
vi.mock('../components/ReferenceDataSettings', () => ({ default: () => <div data-testid="tab-reference" /> }));
vi.mock('../components/UsersAndRoles', () => ({ default: () => <div data-testid="tab-users" /> }));
vi.mock('../components/PermissionsMatrix', () => ({ default: () => <div data-testid="tab-permissions" /> }));
vi.mock('../components/BackupAndRestore', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../components/SystemReset', () => ({ default: () => <div data-testid="tab-reset" /> }));
vi.mock('../components/AuditLogs', () => ({ default: () => <div data-testid="tab-audit" /> }));
vi.mock('../components/OfflineSettings', () => ({ default: () => <div data-testid="tab-offline" /> }));
vi.mock('../components/PrintingTemplates', () => ({ default: () => <div data-testid="tab-printing" /> }));
vi.mock('../components/ThemeAndLocalization', () => ({ default: () => <div data-testid="tab-theme" /> }));

import SettingsPage from '../Settings';

const baseProps = () => ({
  settings: { companyName: '', currency: '', address: '', phone: '' },
  onUpdateSettings: vi.fn(),
  reportConfig: [],
  onUpdateReportConfig: vi.fn(),
  openingBalanceReportConfig: [],
  onUpdateOpeningBalanceReportConfig: vi.fn(),
});

const TABS = {
  'settings.view.general': 'الإعدادات العامة',
  'users.view': 'المستخدمون والأدوار',
  'users.update': 'مصفوفة الصلاحيات',
  'backup.view': 'النسخ الاحتياطي',
  'admin.reset_system': 'إعادة الضبط',
  'users.audit': 'سجلات التدقيق',
  'theme.view': 'الثيم واللغة',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = [];
  mocks.hasPermission.mockImplementation((permission: string) => mocks.permissions.includes(permission));
});

// In a Router, because the page reads `?tab=` for gate 3.6. Rendering it bare throws on
// the first `useSearchParams` call, which says nothing about the permissions under test.
const renderPage = (element: React.ReactElement) =>
  render(<MemoryRouter initialEntries={['/settings']}>{element}</MemoryRouter>);

describe('#14 the settings page reads one source of truth for permissions', () => {
  it('shows a tab the session grants', async () => {
    mocks.permissions = ['settings.view.general'];
    renderPage(<SettingsPage {...baseProps()} />);
    expect(await screen.findByText(TABS['settings.view.general'])).toBeInTheDocument();
  });

  it('shows nothing at all when the session grants nothing', async () => {
    // FC-SEC-005 fail-closed: an empty list means no tabs, never a fallback.
    mocks.permissions = [];
    renderPage(<SettingsPage {...baseProps()} currentUser={{ permissions: ['*'] } as never} />);
    expect(screen.queryByText(TABS['settings.view.general'])).toBeNull();
    expect(screen.queryByText(TABS['backup.view'])).toBeNull();
  });

  it('does not open a tab from a grant that exists only on currentUser', async () => {
    // The defect: tab visibility was the union of the session and `currentUser`, so a
    // permission removed from a role stayed visible until the next sign-in — the
    // fail-open direction — while every call inside the tab returned 403.
    mocks.permissions = [];
    renderPage(<SettingsPage {...baseProps()} currentUser={{ permissions: ['backup.view'] } as never} />);
    await waitFor(() => expect(screen.queryByText(TABS['backup.view'])).toBeNull());
  });

  it('keeps hiding a tab the union would have revived', async () => {
    mocks.permissions = ['settings.view.general'];
    renderPage(
      <SettingsPage
        {...baseProps()}
        currentUser={{ permissions: ['admin.reset_system', 'backup.view'] } as never}
      />,
    );
    expect(await screen.findByText(TABS['settings.view.general'])).toBeInTheDocument();
    expect(screen.queryByText(TABS['admin.reset_system'])).toBeNull();
    expect(screen.queryByText(TABS['backup.view'])).toBeNull();
  });
});

/**
 * Gate 4.10 - the tab switch is what loses the edits, so it is what has to ask.
 *
 * `renderTab()` unmounts the current panel, and a panel holding typed-in work kept
 * it in state. The screen guarded `beforeunload` — closing the window, which already
 * had its own prompt — and left the one exit that had none unguarded. Unmounting is
 * silent by construction, so this asserts on the confirm and on the tab not changing.
 */
describe('#25 a dirty panel is not unmounted without asking', () => {
  // The real GeneralSettings is what renders here - the lazy stubs above do not
  // intercept the dynamic imports this page uses, which is fine, because a test that
  // types into the real form and watches a real unmount is stronger than one that
  // calls a mock. `loadSystemSettings` is not mocked here so the load fails, but the
  // form still renders with the values the page was handed.
  beforeEach(() => {
    mocks.hasPermission.mockImplementation((permission: string) =>
      ['settings.view.general', 'users.view'].includes(permission));
  });

  const dirtyTheForm = async () => {
    const nameInput = await screen.findByLabelText(/اسم الشركة/);
    fireEvent.change(nameInput, { target: { value: 'اسم جديد' } });
  };

  it('leaves the tab alone when the operator declines', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage(<SettingsPage {...baseProps()} />);
    await dirtyTheForm();

    fireEvent.click(screen.getByRole('tab', { name: TABS['users.view'] }));

    expect(confirmSpy).toHaveBeenCalled();
    // Still on general: the form the operator typed into is still mounted.
    expect(screen.getByLabelText(/اسم الشركة/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('switches when the operator accepts', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage(<SettingsPage {...baseProps()} />);
    await dirtyTheForm();

    fireEvent.click(screen.getByRole('tab', { name: TABS['users.view'] }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText('المستخدمون والأدوار', { selector: 'h1, h2, h3' }).catch(() => null))
      .toBeDefined();
    confirmSpy.mockRestore();
  });

  it('does not ask when there is nothing to lose', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage(<SettingsPage {...baseProps()} />);
    // Wait for the form so the click is not racing the load.
    await screen.findByLabelText(/اسم الشركة/);

    fireEvent.click(screen.getByRole('tab', { name: TABS['users.view'] }));

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});