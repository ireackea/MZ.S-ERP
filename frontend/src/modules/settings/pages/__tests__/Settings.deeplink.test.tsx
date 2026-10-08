import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => mocks.permissions.includes(permission),
    permissions: mocks.permissions,
  }),
}));

vi.mock('../../components/GeneralSettings', () => ({ default: () => <div data-testid="tab-general" /> }));
vi.mock('../../components/ReferenceDataSettings', () => ({ default: () => <div data-testid="tab-reference" /> }));
vi.mock('../../components/UsersAndRoles', () => ({ default: () => <div data-testid="tab-users" /> }));
vi.mock('../../components/PermissionsMatrix', () => ({ default: () => <div data-testid="tab-permissions" /> }));
vi.mock('../../components/BackupAndRestore', () => ({ default: () => <div data-testid="tab-backup" /> }));
vi.mock('../../components/SystemReset', () => ({ default: () => <div data-testid="tab-reset" /> }));
vi.mock('../../components/AuditLogs', () => ({ default: () => <div data-testid="tab-audit" /> }));
vi.mock('../../components/OfflineSettings', () => ({ default: () => <div data-testid="tab-offline" /> }));
vi.mock('../../components/PrintingTemplates', () => ({ default: () => <div data-testid="tab-printing" /> }));
vi.mock('../../components/ThemeAndLocalization', () => ({ default: () => <div data-testid="tab-theme" /> }));

import SettingsPage from '../Settings';

const baseProps = () => ({
  settings: { companyName: '', currency: '', address: '', phone: '' },
  onUpdateSettings: vi.fn(),
  reportConfig: [],
  onUpdateReportConfig: vi.fn(),
  openingBalanceReportConfig: [],
  onUpdateOpeningBalanceReportConfig: vi.fn(),
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsPage {...baseProps()} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = [
    'settings.view.general', 'users.view', 'users.update', 'backup.view',
    'admin.reset_system', 'users.audit', 'theme.view',
  ];
});

describe('gate 3.6 the settings tab is addressable', () => {
  it('opens the tab named in the query string', async () => {
    renderAt('/settings?tab=audit');
    expect(await screen.findByTestId('tab-audit')).toBeInTheDocument();
  });

  it('opens the first tab when the query string is absent', async () => {
    renderAt('/settings');
    expect(await screen.findByTestId('tab-general')).toBeInTheDocument();
  });

  it('opens the first tab when the query string names one this session may not see', async () => {
    // A shared link must not open a screen the session lacks the permission for, and
    // must not leave the URL claiming otherwise.
    mocks.permissions = ['settings.view.general'];
    renderAt('/settings?tab=audit');
    expect(await screen.findByTestId('tab-general')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-audit')).toBeNull();
  });

  it('falls back to a real tab for a key that does not exist', async () => {
    renderAt('/settings?tab=nonsense');
    expect(await screen.findByTestId('tab-general')).toBeInTheDocument();
  });

  it('moves the selection when a tab is clicked', async () => {
    renderAt('/settings');
    await screen.findByTestId('tab-general');

    fireEvent.click(screen.getByText('سجلات التدقيق'));
    expect(await screen.findByTestId('tab-audit')).toBeInTheDocument();
  });
});