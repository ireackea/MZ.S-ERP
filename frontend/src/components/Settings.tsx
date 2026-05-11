import React from 'react';
import SettingsPage from '../modules/settings/pages/Settings';
import type {
  OperationAppearance,
  ReportColumnConfig,
  SystemSettings,
  Tag,
  UnloadingRule,
  User,
} from '../types';

export interface SettingsProps {
  users: User[];
  onAddUser: (user: User) => void;
  onUpdateUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
  tags: Tag[];
  onAddTag: (tag: Tag) => void;
  onDeleteTag: (id: string) => void;
  units: string[];
  onAddUnit: (unit: string) => void;
  onDeleteUnit: (unit: string) => void;
  categories: string[];
  onAddCategory: (category: string) => void;
  onDeleteCategory: (category: string) => void;
  settings: SystemSettings;
  onUpdateSettings: (settings: SystemSettings) => void;
  appearance: OperationAppearance[];
  onUpdateAppearance: (appearance: OperationAppearance[]) => void;
  reportConfig: ReportColumnConfig[];
  onUpdateReportConfig: (config: ReportColumnConfig[]) => void;
  openingBalanceReportConfig: ReportColumnConfig[];
  onUpdateOpeningBalanceReportConfig: (config: ReportColumnConfig[]) => void;
  unloadingRules: UnloadingRule[];
  onAddUnloadingRule: (rule: UnloadingRule) => void;
  onDeleteUnloadingRule: (id: string) => void;
  onUpdateUnloadingRule: (rule: UnloadingRule) => void;
  allItems: unknown[];
  allTransactions: unknown[];
  currentUser?: User;
  onSwitchUser?: (userId: string) => void;
}

const Settings: React.FC<SettingsProps> = ({
  settings,
  onUpdateSettings,
  reportConfig,
  onUpdateReportConfig,
  openingBalanceReportConfig,
  onUpdateOpeningBalanceReportConfig,
  currentUser,
}) => (
  <SettingsPage
    settings={settings}
    onUpdateSettings={onUpdateSettings}
    reportConfig={reportConfig}
    onUpdateReportConfig={onUpdateReportConfig}
    openingBalanceReportConfig={openingBalanceReportConfig}
    onUpdateOpeningBalanceReportConfig={onUpdateOpeningBalanceReportConfig}
    currentUser={currentUser}
  />
);

export default Settings;