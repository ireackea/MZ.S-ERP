// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { DatabaseBackup, FileText, Globe2, LayoutGrid, Package, RefreshCcw, Settings2, Shield, Users } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import type { ReportColumnConfig, SystemSettings, User } from '../../../types';

const GeneralSettings = lazy(() => import('../components/GeneralSettings'));
const ReferenceDataSettings = lazy(() => import('../components/ReferenceDataSettings'));
const UsersAndRoles = lazy(() => import('../components/UsersAndRoles'));
const PermissionsMatrix = lazy(() => import('../components/PermissionsMatrix'));
const BackupAndRestore = lazy(() => import('../components/BackupAndRestore'));
const SystemReset = lazy(() => import('../components/SystemReset'));
const AuditLogs = lazy(() => import('../components/AuditLogs'));
const OfflineSettings = lazy(() => import('../components/OfflineSettings'));
const PrintingTemplates = lazy(() => import('../components/PrintingTemplates'));
const ThemeAndLocalization = lazy(() => import('../components/ThemeAndLocalization'));

interface SettingsPageProps {
  settings: SystemSettings;
  onUpdateSettings: (settings: SystemSettings) => void;
  reportConfig: ReportColumnConfig[];
  onUpdateReportConfig: (config: ReportColumnConfig[]) => void;
  openingBalanceReportConfig: ReportColumnConfig[];
  onUpdateOpeningBalanceReportConfig: (config: ReportColumnConfig[]) => void;
  currentUser?: User;
}

type SettingsTabKey =
  | 'general'
  | 'reference-data'
  | 'users'
  | 'permissions'
  | 'backup'
  | 'reset'
  | 'audit'
  | 'offline'
  | 'printing'
  | 'theme';

const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  reportConfig,
  onUpdateReportConfig,
  openingBalanceReportConfig,
  onUpdateOpeningBalanceReportConfig,
  currentUser,
}) => {
  const { hasPermission, permissions } = usePermissions();

  const tabs = useMemo(() => ([
    { key: 'general' as const, label: 'الإعدادات العامة', permission: 'settings.view.general', icon: Settings2 },
    { key: 'reference-data' as const, label: 'الأقسام ووحدات القياس', permission: 'settings.view.general', icon: Package },
    { key: 'users' as const, label: 'المستخدمون والأدوار', permission: 'users.view', icon: Users },
    { key: 'permissions' as const, label: 'مصفوفة الصلاحيات', permission: 'users.update', icon: Shield },
    { key: 'backup' as const, label: 'النسخ الاحتياطي', permission: 'backup.view', icon: DatabaseBackup },
    { key: 'reset' as const, label: 'إعادة الضبط', permission: 'admin.reset_system', icon: RefreshCcw },
    { key: 'audit' as const, label: 'سجلات التدقيق', permission: 'users.audit', icon: FileText },
    { key: 'offline' as const, label: 'إعدادات الأوفلاين', permission: 'settings.view.general', icon: LayoutGrid },
    { key: 'printing' as const, label: 'قوالب الطباعة', permission: 'settings.view.general', icon: FileText },
    { key: 'theme' as const, label: 'الثيم واللغة', permission: 'theme.view', icon: Globe2 },
  ]), []);

  // FC-SEC-005 / #14 — one source of truth: the session.
  //
  // This was a union of the session's permissions and `currentUser.permissions`. The
  // union is the fail-*open* direction, which is why it was wrong even though the two
  // usually agree: remove a permission from a role, and the session still carries it
  // until the next sign-in, so the union keeps a tab visible whose every API call
  // returns 403. The comment above it claimed fail-closed while the union sat right
  // underneath — the assertion and the code described different things.
  //
  // They converge without the merge: `App.tsx` writes the reconciled user back to the
  // auth session (`setAuthUser`) when the users list changes, and `usePermissions`
  // reads that session. So a revoked permission disappears as soon as the refresh that
  // carried its removal arrives, and no second source can outlive the first.
  const visibleTabs = tabs.filter((tab) => hasPermission(tab.permission));
  const grantedPermissionsPreview = useMemo(
    () => permissions.slice().sort().slice(0, 8),
    [permissions],
  );
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(visibleTabs[0]?.key || 'general');

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'general');
    }
  }, [activeTab, visibleTabs]);

  const resolvedActiveTab = visibleTabs.find((tab) => tab.key === activeTab)?.key || visibleTabs[0]?.key;

  const renderTab = () => {
    switch (resolvedActiveTab) {
      case 'general':
        return <GeneralSettings settings={settings} onUpdateSettings={onUpdateSettings} />;
      case 'reference-data':
        return <ReferenceDataSettings />;
      case 'users':
        return <UsersAndRoles />;
      case 'permissions':
        return <PermissionsMatrix />;
      case 'backup':
        return <BackupAndRestore currentUser={currentUser} />;
      case 'reset':
        return <SystemReset currentUser={currentUser} />;
      case 'audit':
        return <AuditLogs />;
      case 'offline':
        return <OfflineSettings />;
      case 'printing':
        return (
          <PrintingTemplates
            reportConfig={reportConfig}
            onUpdateReportConfig={onUpdateReportConfig}
            openingBalanceReportConfig={openingBalanceReportConfig}
            onUpdateOpeningBalanceReportConfig={onUpdateOpeningBalanceReportConfig}
          />
        );
      case 'theme':
        return <ThemeAndLocalization />;
      default:
        return null;
    }
  };

  if (visibleTabs.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="text-base font-black">ليس لديك أي صلاحية للوصول إلى قسم الإعدادات.</div>
        <div className="mt-2 text-sm">لا توجد أي تبويبات إعدادات مفعّلة لحسابك الحالي.</div>
        <div className="mt-3 text-xs leading-6">
          <div>الصلاحيات النموذجية للوصول: <code>settings.view.general</code> أو <code>users.view</code> أو <code>backup.view</code>.</div>
          <div>عدد الصلاحيات الممنوحة حاليًا: <strong>{permissions.length}</strong></div>
          {grantedPermissionsPreview.length > 0 ? (
            <div className="mt-1 break-all">{grantedPermissionsPreview.join(' | ')}</div>
          ) : (
            <div className="mt-1">لا توجد صلاحيات في الجلسة الحالية.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black text-slate-900">الإعدادات العالمية</h1>
        <p className="mt-2 text-sm text-slate-500">لوحة إعدادات موحدة تغطي التهيئة العامة، الأقسام ووحدات القياس، قواعد التفريغ، الصلاحيات، النسخ الاحتياطية، التدقيق، والطباعة.</p>
      </div>
      <div
        role="tablist"
        aria-label="أقسام الإعدادات"
        className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === resolvedActiveTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`settings-tab-${tab.key}`}
              aria-selected={active}
              aria-controls={`settings-panel-${tab.key}`}
              // Roving tabindex: the strip is one stop in the tab order, and the
              // arrow keys move within it. Without this, ten buttons are ten tab
              // stops for something that is conceptually one control.
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                const index = visibleTabs.findIndex((entry) => entry.key === tab.key);
                const nextIndex =
                  event.key === 'ArrowRight'
                    ? (index + 1) % visibleTabs.length
                    : (index - 1 + visibleTabs.length) % visibleTabs.length;
                const next = visibleTabs[nextIndex];
                if (!next) return;
                setActiveTab(next.key);
                document.getElementById(`settings-tab-${next.key}`)?.focus();
              }}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              <Icon size={16} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`settings-panel-${resolvedActiveTab}`}
        aria-labelledby={`settings-tab-${resolvedActiveTab}`}
        tabIndex={0}
      >
        <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">جاري تحميل تبويب الإعدادات...</div>}>
        {renderTab()}
      </Suspense>
      </div>
    </div>
  );
};

export default SettingsPage;
