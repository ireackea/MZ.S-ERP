// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { DatabaseBackup, FileText, Globe2, LayoutGrid, Package, RefreshCcw, Settings2, Shield, Users } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import type { AuditLog, ReportColumnConfig, SystemSettings, User } from '../../../types';

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
  auditLogs?: AuditLog[];
  currentUser?: User;
}

type SettingsTabKey =
  | 'general'
  | 'users'
  | 'reference-data'
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
  auditLogs = [],
  currentUser,
}) => {
  const { hasPermission } = usePermissions();
  const role = String(currentUser?.role || '').trim().toLowerCase();
  const isPrivileged = role === 'admin' || role === 'superadmin' || (currentUser?.permissions || []).includes('*');
  const tabs = useMemo(() => ([
    { key: 'general' as const, label: 'الإعدادات العامة', permission: 'settings.view.general', icon: Settings2 },
    { key: 'reference-data' as const, label: 'الأقسام ووحدات القياس', permission: 'settings.view.general', icon: Package },
    { key: 'users' as const, label: 'المستخدمون والأدوار', permission: 'settings.view.users', icon: Users },
    { key: 'permissions' as const, label: 'مصفوفة الصلاحيات', permission: 'settings.view.permissions', icon: Shield },
    { key: 'backup' as const, label: 'النسخ الاحتياطي', permission: 'settings.view.backup', icon: DatabaseBackup },
    { key: 'reset' as const, label: 'إعادة الضبط', permission: 'settings.view.reset', icon: RefreshCcw },
    { key: 'audit' as const, label: 'سجلات التدقيق', permission: 'settings.view.audit', icon: FileText },
    { key: 'offline' as const, label: 'إعدادات الأوفلاين', permission: 'settings.view.offline', icon: LayoutGrid },
    { key: 'printing' as const, label: 'قوالب الطباعة', permission: 'settings.view.printing', icon: FileText },
    { key: 'theme' as const, label: 'الثيم واللغة', permission: 'settings.view.localization', icon: Globe2 },
  ]), []);

  const visibleTabs = isPrivileged ? tabs : tabs.filter((tab) => hasPermission(tab.permission));
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
        return <GeneralSettings settings={settings} onUpdateSettings={onUpdateSettings} forceAccess={isPrivileged} />;
      case 'reference-data':
        return <ReferenceDataSettings forceAccess={isPrivileged} />;
      case 'users':
        return <UsersAndRoles forceAccess={isPrivileged} />;
      case 'permissions':
        return <PermissionsMatrix forceAccess={isPrivileged} />;
      case 'backup':
        return <BackupAndRestore currentUser={currentUser} forceAccess={isPrivileged} />;
      case 'reset':
        return <SystemReset forceAccess={isPrivileged} />;
      case 'audit':
        return <AuditLogs logs={auditLogs} forceAccess={isPrivileged} />;
      case 'offline':
        return <OfflineSettings forceAccess={isPrivileged} />;
      case 'printing':
        return (
          <PrintingTemplates
            reportConfig={reportConfig}
            onUpdateReportConfig={onUpdateReportConfig}
            openingBalanceReportConfig={openingBalanceReportConfig}
            onUpdateOpeningBalanceReportConfig={onUpdateOpeningBalanceReportConfig}
            forceAccess={isPrivileged}
          />
        );
      case 'theme':
        return <ThemeAndLocalization forceAccess={isPrivileged} />;
      default:
        return null;
    }
  };

  if (!isPrivileged && !hasPermission('settings.view') && visibleTabs.length === 0) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">ليس لديك أي صلاحية للوصول إلى قسم الإعدادات.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black text-slate-900">الإعدادات العالمية</h1>
        <p className="mt-2 text-sm text-slate-500">لوحة إعدادات موحدة تغطي التهيئة العامة، الأقسام ووحدات القياس، الصلاحيات، النسخ الاحتياطية، التدقيق، والطباعة.</p>
      </div>
      <div className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === resolvedActiveTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">جاري تحميل تبويب الإعدادات...</div>}>
        {renderTab()}
      </Suspense>
    </div>
  );
};

export default SettingsPage;