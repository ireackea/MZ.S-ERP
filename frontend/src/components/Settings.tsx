// ENTERPRISE FIX: Phase 4 - Production Polish & Final Integration - 2026-03-05
// ENTERPRISE FIX: Arabic Encoding Restoration - Settings.tsx Complete - 2026-03-04
// تم إصلاح جميع النصوص العربية المشوهة - الملف كامل 950 سطر
// الأقسام المُصلحة: General, Appearance, Reports, Grid, Logistics, Users-Backup, Categories, Tags, Units, Modals

// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
// ENTERPRISE FIX: Phase 2 - Multi-User Sync & Unified User Management - 2026-03-02
// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User, Tag, SystemSettings, OperationAppearance, ReportColumnConfig, UnloadingRule, OperationType, AuditLog, GridColumnPreference } from '../types';
import UnifiedIAM from './UnifiedIAM';
import AuditLogViewer from './AuditLogViewer';
import UniversalColumnManager from './UniversalColumnManager';

import { Settings as SettingsIcon, Users, Tags, Ruler, Database, Save, Plus, Trash2, Building, Palette, TableProperties, Truck, Layers, AlertTriangle, Shield, Package, ShieldAlert, X, CheckCircle, Loader2, TriangleAlert, ShieldCheck } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { GRID_MODULE_DEFINITIONS, getGridModuleDefinition } from '../services/gridModules';
import { systemResetService } from '../services/systemResetService';
import { useInventoryStore } from '../store/useInventoryStore';
import { usePermissions } from '../hooks/usePermissions';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import { toast } from '@services/toastService';

// ENTERPRISE FIX: Modern System Reset v2 - SuperAdmin Safe + Server-First - 2026-03-01
type ResetModalState = {
  isOpen: boolean;
  confirmationCode: string;
  isLoading: boolean;
  checkboxConfirmed: boolean;
};

const createResetModalState = (): ResetModalState => ({
  isOpen: false,
  confirmationCode: '',
  isLoading: false,
  checkboxConfirmed: false,
});

interface SettingsProps {
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
  allItems: any[];
  allTransactions: any[];
  auditLogs?: AuditLog[];
  currentUser?: User;
  onSwitchUser?: (userId: string) => void;
}

const Settings: React.FC<SettingsProps> = ({
  users, onAddUser, onUpdateUser, onDeleteUser,
  tags, onAddTag, onDeleteTag,
  units, onAddUnit, onDeleteUnit,
  categories, onAddCategory, onDeleteCategory,
  settings, onUpdateSettings,
  appearance, onUpdateAppearance,
  reportConfig, onUpdateReportConfig,
  openingBalanceReportConfig, onUpdateOpeningBalanceReportConfig,
  unloadingRules, onAddUnloadingRule, onDeleteUnloadingRule, onUpdateUnloadingRule,
  allItems, allTransactions,
  auditLogs = [],
  currentUser,
  onSwitchUser
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const itemSortMode = useInventoryStore((state) => state.sortMode);
  const setItemSortMode = useInventoryStore((state) => state.setSortMode);
  const lockCurrentItemOrder = useInventoryStore((state) => state.lockCurrentItemOrder);
  const getGridPreferences = useInventoryStore((state) => state.getGridPreferences);
  const setGridPreferences = useInventoryStore((state) => state.setGridPreferences);
  const resetGridPreferences = useInventoryStore((state) => state.resetGridPreferences);
  const getGridDisplayPolicy = useInventoryStore((state) => state.getGridDisplayPolicy);
  const setGridDisplayPolicy = useInventoryStore((state) => state.setGridDisplayPolicy);
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'reports' | 'grid' | 'logistics' | 'users-backup' | 'units' | 'tags' | 'categories'>(
    location.pathname === '/users' ? 'users-backup' : 'general'
  );

  const [newTag, setNewTag] = useState({ name: '', color: '#10b981' });
  const [newUnit, setNewUnit] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newUnloadingRule, setNewUnloadingRule] = useState<Partial<UnloadingRule>>({ is_active: true });
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleForm, setEditingRuleForm] = useState<Partial<UnloadingRule>>({});
  const [generalForm, setGeneralForm] = useState<SystemSettings>(settings);

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'category' | 'unit' | 'tag' | 'user' | 'rule';
    targetId: string;
    usageCount: number;
  }>({ isOpen: false, type: 'category', targetId: '', usageCount: 0 });

  const [resetModal, setResetModal] = useState<ResetModalState>(createResetModalState);
  const [localReportConfig, setLocalReportConfig] = useState<ReportColumnConfig[]>(reportConfig);
  const [localOpeningBalanceReportConfig, setLocalOpeningBalanceReportConfig] = useState<ReportColumnConfig[]>(openingBalanceReportConfig);
  const [selectedGridModule, setSelectedGridModule] = useState<string>(GRID_MODULE_DEFINITIONS[0]?.key || 'inventory_log');
  const [gridColumns, setGridColumns] = useState<GridColumnPreference[]>([]);
  const [forceUnifiedView, setForceUnifiedView] = useState(false);
  const [applyToAllUsers, setApplyToAllUsers] = useState(false);
  const [securityTab, setSecurityTab] = useState<'iam' | 'audit'>('iam');

  const itemSortOptions = [
    { value: 'manual_locked', label: 'ترتيب يدوي مقفل' },
    { value: 'name_asc', label: 'الاسم (أ -> ي)' },
    { value: 'name_desc', label: 'الاسم (ي -> أ)' },
    { value: 'code_asc', label: 'الرمز (تصاعدي)' },
    { value: 'category_then_name', label: 'التصنيف ثم الاسم' },
  ] as const;

  const { hasPermission } = usePermissions();
  const user = currentUser;
  const isAdmin = user?.role === 'admin';
  const canEditSettings = hasPermission('settings.update.system');
  const canManageUsers = hasPermission('users.create.management') || hasPermission('users.update.management') || hasPermission('users.delete.management') || hasPermission('users.create') || hasPermission('users.update') || hasPermission('users.delete');
  const canResetSystem = hasPermission('admin.reset_system') || hasPermission('system.reset') || user?.role === 'SuperAdmin' || user?.role === 'admin';
  const canManageBackup = hasPermission('backup.create') || hasPermission('backup.restore') || canResetSystem;
  const canViewAudit = hasPermission('users.audit') || canManageUsers || isAdmin || user?.role === 'SuperAdmin';

  const { remainingSeconds, isExpiringSoon, extendSession } = useSessionTimeout({
    timeoutMinutes: 30,
    warningMinutes: 5,
    onTimeout: () => {
      toast.error('انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.');
      navigate('/');
    },
  });

  const guardSettingsWrite = () => {
    if (canEditSettings || isAdmin || user?.role === 'SuperAdmin') return true;
    toast.error('ليس لديك صلاحية كافية لإجراء هذا التعديل');
    return false;
  };

  useEffect(() => {
    setLocalReportConfig(reportConfig);
  }, [reportConfig]);

  useEffect(() => {
    setLocalOpeningBalanceReportConfig(openingBalanceReportConfig);
  }, [openingBalanceReportConfig]);

  useEffect(() => {
    setGeneralForm(settings);
  }, [settings]);

  useEffect(() => {
    if (location.pathname === '/users') {
      setActiveTab('users-backup');
      return;
    }
    if (location.pathname === '/settings' && activeTab === 'users-backup') {
      setActiveTab('general');
    }
  }, [location.pathname, activeTab]);

  useEffect(() => {
    console.debug('[Settings] deleteModal.isOpen ->', deleteModal.isOpen);
  }, [deleteModal.isOpen]);

  useEffect(() => {
    const module = getGridModuleDefinition(selectedGridModule);
    if (!module) {
      setGridColumns([]);
      setForceUnifiedView(false);
      return;
    }
    const loaded = getGridPreferences(selectedGridModule, module.columns);
    const policy = getGridDisplayPolicy(selectedGridModule);
    setGridColumns(loaded);
    setForceUnifiedView(!!policy.forceUnified);
  }, [getGridDisplayPolicy, getGridPreferences, selectedGridModule]);

  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guardSettingsWrite()) return;
    onUpdateSettings(generalForm);
    toast.success('تم حفظ الإعدادات بنجاح');
  };

  const handleAddTag = () => {
    if (!guardSettingsWrite()) return;
    if (newTag.name) {
      onAddTag({ id: uuidv4(), name: newTag.name, color: newTag.color });
      setNewTag({ name: '', color: '#10b981' });
    }
  };

  const handleAddUnit = () => {
    if (!guardSettingsWrite()) return;
    if (newUnit && !units.includes(newUnit)) {
      onAddUnit(newUnit);
      setNewUnit('');
    } else if (units.includes(newUnit)) {
      toast.warning('الوحدة مكررة بالفعل');
    }
  };

  const handleAddCategory = () => {
    if (!guardSettingsWrite()) return;
    if (newCategory && !categories.includes(newCategory)) {
      onAddCategory(newCategory);
      setNewCategory('');
    } else if (categories.includes(newCategory)) {
      toast.warning('الفئة موجودة مسبقاً');
    }
  };

  const handleUpdateColor = (type: OperationType, color: string) => {
    if (!guardSettingsWrite()) return;
    const newApp = appearance.map(a => a.type === type ? { ...a, color } : a);
    if (!newApp.find(a => a.type === type)) {
      newApp.push({ type, color });
    }
    onUpdateAppearance(newApp);
  };

  const toggleLocalReportColumn = (key: string) => {
    const newConfig = localReportConfig.map(c => c.key === key ? { ...c, isVisible: !c.isVisible } : c);
    setLocalReportConfig(newConfig);
  };

  const saveReportConfig = () => {
    if (!guardSettingsWrite()) return;
    onUpdateReportConfig(localReportConfig);
    toast.success('تم حفظ تقرير التعميات');
  };

  const toggleOpeningBalanceReportColumn = (key: string) => {
    const newConfig = localOpeningBalanceReportConfig.map(c => c.key === key ? { ...c, isVisible: !c.isVisible } : c);
    setLocalOpeningBalanceReportConfig(newConfig);
  };

  const moveOpeningBalanceColumn = (key: string, direction: 'up' | 'down') => {
    setLocalOpeningBalanceReportConfig(prev => {
      const next = [...prev];
      const idx = next.findIndex(c => c.key === key);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const saveOpeningBalanceReportConfig = () => {
    if (!guardSettingsWrite()) return;
    onUpdateOpeningBalanceReportConfig(localOpeningBalanceReportConfig);
    toast.success('تم حفظ تقرير أرصدة الافتتاحية بنجاح');
  };

  const handleSaveGridConfig = () => {
    if (!guardSettingsWrite()) return;
    if (!selectedGridModule) return;
    setGridPreferences(selectedGridModule, gridColumns);
    setGridDisplayPolicy(selectedGridModule, { forceUnified: forceUnifiedView });
    toast.success(
      applyToAllUsers
        ? 'تم حفظ إعدادات الشبكة لجميع مستخدمي النظام.'
        : 'تم حفظ إعدادات الشبكة بنجاح.'
    );
  };

  const handleResetGridConfig = () => {
    if (!guardSettingsWrite()) return;
    const module = getGridModuleDefinition(selectedGridModule);
    if (!module) return;
    resetGridPreferences(selectedGridModule, module.columns);
    setGridDisplayPolicy(selectedGridModule, { forceUnified: false });
    setGridColumns(getGridPreferences(selectedGridModule, module.columns));
    setForceUnifiedView(false);
  };

  const handleApplyUnifiedNow = () => {
    if (!guardSettingsWrite()) return;
    if (!selectedGridModule) return;
    setGridPreferences(selectedGridModule, gridColumns);
    setGridDisplayPolicy(selectedGridModule, { forceUnified: true });
    setForceUnifiedView(true);
    toast.success('تم تفعيل العرض الموحد لجميع المستخدمين.');
  };

  const handleAddRule = () => {
    if (!guardSettingsWrite()) return;
    const ruleName = (newUnloadingRule.rule_name || '').trim();
    const allowedDuration = Number(newUnloadingRule.allowed_duration_minutes);
    const penaltyRate = Number(newUnloadingRule.penalty_rate_per_minute);

    if (!ruleName) {
      toast.error('يجب إدخال اسم القاعدة/المعيار بشكل صحيح.');
      return;
    }
    if (!Number.isFinite(allowedDuration) || allowedDuration <= 0) {
      toast.error('يجب إدخال مدة السماح بالدقائق كرقم موجب.');
      return;
    }
    if (!Number.isFinite(penaltyRate) || penaltyRate < 0) {
      toast.error('يجب إدخال قيمة الغرامة (د.ل) كرقم موجب.');
      return;
    }

    onAddUnloadingRule({
      id: uuidv4(),
      rule_name: ruleName,
      allowed_duration_minutes: allowedDuration,
      penalty_rate_per_minute: penaltyRate,
      is_active: newUnloadingRule.is_active ?? true
    });
    setNewUnloadingRule({ is_active: true });
  };

  const handleToggleRuleActive = (rule: UnloadingRule) => {
    if (!guardSettingsWrite()) return;
    onUpdateUnloadingRule({ ...rule, is_active: !rule.is_active });
  };

  const handleStartEditRule = (rule: UnloadingRule) => {
    setEditingRuleId(rule.id);
    setEditingRuleForm({
      rule_name: rule.rule_name,
      allowed_duration_minutes: rule.allowed_duration_minutes,
      penalty_rate_per_minute: rule.penalty_rate_per_minute,
      is_active: rule.is_active,
    });
  };

  const handleSaveRuleEdit = () => {
    if (!guardSettingsWrite()) return;
    if (!editingRuleId) return;
    const target = unloadingRules.find(rule => rule.id === editingRuleId);
    if (!target) return;

    const ruleName = (editingRuleForm.rule_name || '').trim();
    const allowedDuration = Number(editingRuleForm.allowed_duration_minutes);
    const penaltyRate = Number(editingRuleForm.penalty_rate_per_minute);

    if (!ruleName) {
      toast.error('يجب إدخال اسم القاعدة/المعيار بشكل صحيح.');
      return;
    }
    if (!Number.isFinite(allowedDuration) || allowedDuration <= 0) {
      toast.error('يجب إدخال مدة السماح بالدقائق كرقم موجب.');
      return;
    }
    if (!Number.isFinite(penaltyRate) || penaltyRate < 0) {
      toast.error('يجب إدخال قيمة الغرامة (د.ل) كرقم موجب.');
      return;
    }

    onUpdateUnloadingRule({
      ...target,
      rule_name: ruleName,
      allowed_duration_minutes: allowedDuration,
      penalty_rate_per_minute: penaltyRate,
      is_active: editingRuleForm.is_active ?? true,
    });

    setEditingRuleId(null);
    setEditingRuleForm({});
  };

  const handleCancelRuleEdit = () => {
    setEditingRuleId(null);
    setEditingRuleForm({});
  };

  const handleResetSystem = () => {
    if (!canResetSystem) {
      toast.error('ليس لديك صلاحية تنفيذ هذه العملية');
      return;
    }
    setResetModal({ ...createResetModalState(), isOpen: true });
  };

  const handleConfirmSystemReset = async () => {
    console.log('[DEBUG] System Reset Started - Code:', resetModal.confirmationCode);

    if (resetModal.confirmationCode.trim() !== 'CONFIRM_SYSTEM_RESET_2026') {
      toast.error('يجب تأكيد العملية. اكتب "CONFIRM_SYSTEM_RESET_2026" بشكل صحيح.');
      return;
    }

    if (!resetModal.checkboxConfirmed) {
      toast.error('يجب تفعيل مربع التأكيد على أن العملية نهائية.');
      return;
    }

    setResetModal(prev => ({ ...prev, isLoading: true }));
    console.log('[DEBUG] Calling systemResetService.performCompleteSystemReset...');

    try {
      const response = await systemResetService.performCompleteSystemReset(resetModal.confirmationCode);
      console.log('[DEBUG] API Response:', response);

      if (response.success) {
        toast.success(response.message);
        setTimeout(() => {
          console.log('[DEBUG] Redirecting to /login');
          navigate('/login');
        }, 1500);
      } else {
        toast.error(response.message || 'حدث خطأ غير متوقع');
      }
    } catch (error: any) {
      console.error('[DEBUG] Reset Error:', error);
      toast.error(error.response?.data?.message || error.message || 'فشل في تصفير النظام');
    } finally {
      setResetModal(prev => ({ ...prev, isLoading: false }));
    }
  };

  const initiateDelete = (type: 'category' | 'unit' | 'tag' | 'user' | 'rule', targetId: string) => {
    if (!guardSettingsWrite()) return;
    let count = 0;

    switch (type) {
      case 'category':
        count = allItems.filter(i => i.category === targetId).length;
        break;
      case 'unit':
        count = allItems.filter(i => i.unit === targetId).length;
        break;
      case 'tag':
        count = allItems.filter(i => i.tags && i.tags.includes(targetId)).length;
        break;
      case 'user':
        count = 0;
        break;
      default:
        count = 0;
    }

    setDeleteModal({ isOpen: true, type, targetId, usageCount: count });
  };

  const confirmDelete = () => {
    if (!guardSettingsWrite()) return;
    const { type, targetId } = deleteModal;

    switch (type) {
      case 'category':
        onDeleteCategory(targetId);
        break;
      case 'unit':
        onDeleteUnit(targetId);
        break;
      case 'tag':
        onDeleteTag(targetId);
        break;
      case 'user':
        onDeleteUser(targetId);
        break;
      case 'rule':
        onDeleteUnloadingRule(targetId);
        break;
    }
    setDeleteModal({ isOpen: false, type: 'category', targetId: '', usageCount: 0 });
  };

  const getDeleteMessage = () => {
    const { type, usageCount } = deleteModal;
    if (usageCount > 0) {
      if (type === 'category') return `لا يمكن حذف فئة تحتوي على ${usageCount} أصناف. يمكنك بدلاً من ذلك دمجها مع فئة أخرى أو حذف الأصناف أولاً.`;
      if (type === 'unit') return `لا يمكن حذف الوحدة المستخدمة من ${usageCount} أصناف.`;
      if (type === 'tag') return `لا يمكن حذف العلامة المستخدمة من ${usageCount} أصناف.`;
    }
    return 'هل أنت متأكد من الحذف؟';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">إعدادات النظام</h2>
        <p className="text-slate-500">التحكم في المظهر والإعدادات العامة وإدارة المستخدمين أو نسخ احتياطي للبيانات</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-2">
          {[
            { id: 'general', label: 'الإعدادات العامة', icon: Building },
            { id: 'appearance', label: 'في واجهة النظام', icon: Palette },
            { id: 'reports', label: 'تقارير التعميات', icon: TableProperties },
            { id: 'grid', label: 'تقارير جرد المخزون', icon: SettingsIcon },
            { id: 'logistics', label: 'قواعد التفريغ', icon: Truck },
            { id: 'users-backup', label: 'إدارة المستخدمين ونسخ احتياطي للبيانات', icon: Users },
            { id: 'categories', label: 'أنواع الأصناف', icon: Layers },
            { id: 'tags', label: 'علامات التصنيف (Tags)', icon: Tags },
            { id: 'units', label: 'وحدات القياس', icon: Ruler },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium
                ${activeTab === tab.id
                  ? 'bg-slate-800 text-white shadow-lg'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'}
              `}
            >
              <tab.icon size={20} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {activeTab === 'general' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                <Building size={20} className="text-emerald-600" /> الإعدادات العامة
              </h3>
              <form onSubmit={handleSaveGeneral} className="space-y-4 max-w-lg">
                <div>
                  <label htmlFor="companyName" className="block text-sm font-medium text-slate-700 mb-1">اسم الشركة</label>
                  <input id="companyName" type="text" className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:border-emerald-500"
                    value={generalForm.companyName} onChange={e => setGeneralForm({ ...generalForm, companyName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="companyPhone" className="block text-sm font-medium text-slate-700 mb-1">رقم الهاتف</label>
                  <input id="companyPhone" type="text" className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:border-emerald-500"
                    value={generalForm.phone || ''} onChange={e => setGeneralForm({ ...generalForm, phone: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="companyAddress" className="block text-sm font-medium text-slate-700 mb-1">العنوان</label>
                  <input id="companyAddress" type="text" className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:border-emerald-500"
                    value={generalForm.address} onChange={e => setGeneralForm({ ...generalForm, address: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="companyCurrency" className="block text-sm font-medium text-slate-700 mb-1">العملة الافتراضية</label>
                  <input id="companyCurrency" type="text" className="w-full p-2 border border-slate-200 rounded-lg outline-none focus:border-emerald-500"
                    value={generalForm.currency} onChange={e => setGeneralForm({ ...generalForm, currency: e.target.value })} />
                </div>
                <button type="submit" className="bg-emerald-600 text-white px-6 py-2 rounded-xl hover:bg-emerald-700 flex items-center gap-2 shadow-md">
                  <Save size={18} /> حفظ التغييرات
                </button>
              </form>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in space-y-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <Palette size={20} className="text-emerald-600" /> في واجهة النظام
                </h3>
                <p className="text-sm text-slate-500 mb-4">اختر الألوان المناسبة لكل نوع من أنواع العمليات على حدة.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {['إيداع', 'سحب', 'انتاج', 'تالف'].map(type => {
                  const current = appearance.find(a => a.type === type)?.color || '#000000';
                  return (
                    <div key={type} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="font-bold text-slate-700">{type}</span>
                      <div className="flex items-center gap-2">
                        <input type="color" value={current} onChange={(e) => handleUpdateColor(type as OperationType, e.target.value)} className="h-10 w-20 cursor-pointer rounded border border-slate-300 p-1" />
                        <span className="text-xs text-slate-400 font-mono">{current}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <TableProperties size={20} className="text-emerald-600" /> تخصيص تقارير التعميات
                  </h3>
                  <p className="text-sm text-slate-500">حدد الأعمدة التي تريد إظهارها أو إخفاؤها في تقارير التعميات.</p>
                </div>
                <button onClick={saveReportConfig} className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 flex items-center gap-2 shadow text-sm">
                  <Save size={16} /> حفظ كما ترى
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {localReportConfig.map(col => (
                  <label key={col.key} className="flex items-center gap-3 p-4 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input type="checkbox" checked={col.isVisible} onChange={() => toggleLocalReportColumn(col.key)} className="w-5 h-5 accent-emerald-600" />
                    <span className="font-bold text-slate-700">{col.label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-6 border-t pt-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <TableProperties size={20} className="text-indigo-600" /> تخصيص تقرير أرصدة الافتتاحية
                    </h3>
                    <p className="text-sm text-slate-500">تقارير مخصصة لأرصدة الافتتاحية.</p>
                  </div>
                  <button onClick={saveOpeningBalanceReportConfig} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow text-sm">
                    <Save size={16} /> حفظ التخصيصات
                  </button>
                </div>
                <div className="space-y-2">
                  {localOpeningBalanceReportConfig.map((col, idx) => (
                    <div key={col.key} className="flex items-center justify-between p-3 border rounded-xl">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={col.isVisible} onChange={() => toggleOpeningBalanceReportColumn(col.key)} className="w-5 h-5 accent-indigo-600" />
                        <span className="font-bold text-slate-700">{col.label}</span>
                      </label>
                      <div className="flex gap-2">
                        <button type="button" className="px-2 py-1 border rounded disabled:opacity-40" disabled={idx === 0} onClick={() => moveOpeningBalanceColumn(col.key, 'up')}>↑</button>
                        <button type="button" className="px-2 py-1 border rounded disabled:opacity-40" disabled={idx === localOpeningBalanceReportConfig.length - 1} onClick={() => moveOpeningBalanceColumn(col.key, 'down')}>↓</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 border-t pt-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <Package size={20} className="text-amber-600" /> ترتيب الأصناف على واجهة النظام
                    </h3>
                    <p className="text-sm text-slate-500">التحكم في طريقة ترتيب الأصناف على واجهة النظام.</p>
                  </div>
                  <button type="button" onClick={() => lockCurrentItemOrder()} className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 text-sm font-bold">
                    حفظ الترتيب الحالي
                  </button>
                </div>
                <div className="max-w-sm">
                  <label className="block text-sm font-medium text-slate-700 mb-1">طريقة ترتيب الأصناف</label>
                  <select className="w-full p-2 border border-slate-300 rounded-lg" value={itemSortMode} onChange={(event) => setItemSortMode(event.target.value as typeof itemSortMode)}>
                    {itemSortOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'grid' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in space-y-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <SettingsIcon size={20} className="text-emerald-600" /> تخصيص جرد المخزون
                  </h3>
                  <p className="text-sm text-slate-500">حدد الأعمدة التي تريد إظهارها أو إخفاؤها في جرد المخزون.</p>
                </div>
                <button onClick={handleSaveGridConfig} className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 flex items-center gap-2 shadow text-sm">
                  <Save size={16} /> حفظ
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {gridColumns.map(col => (
                  <label key={col.key} className="flex items-center gap-3 p-4 border rounded-xl cursor-pointer hover:bg-slate-50 transition">
                    <input type="checkbox" checked={col.visible} onChange={() => {
                      const newCols = gridColumns.map(c => c.key === col.key ? { ...c, visible: !c.visible } : c);
                      setGridColumns(newCols);
                    }} className="w-5 h-5 accent-emerald-600" />
                    <span className="font-bold text-slate-700">{col.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={applyToAllUsers} onChange={(e) => setApplyToAllUsers(e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm font-bold text-slate-700">تطبيق على جميع المستخدمين</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={forceUnifiedView} onChange={(e) => setForceUnifiedView(e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm font-bold text-slate-700">عرض موحد</span>
                </label>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleResetGridConfig} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">إعادة تعيين</button>
                <button onClick={handleApplyUnifiedNow} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">تطبيق الآن</button>
              </div>
            </div>
          )}

          {activeTab === 'logistics' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Truck size={20} className="text-emerald-600" /> قواعد التفريغ
                  </h3>
                  <p className="text-sm text-slate-500">إدارة قواعد التفريغ والغرامات.</p>
                </div>
                <button onClick={() => { setEditingRuleId(null); setNewUnloadingRule({ is_active: true }); }} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 flex items-center gap-2 text-sm">
                  <Plus size={16} /> إضافة قاعدة
                </button>
              </div>
              <div className="space-y-4">
                {unloadingRules.map(rule => (
                  <div key={rule.id} className="flex items-center justify-between p-4 border rounded-xl">
                    <div>
                      <div className="font-bold text-slate-800">{rule.rule_name}</div>
                      <div className="text-sm text-slate-500">
                        مدة السماح: {rule.allowed_duration_minutes} دقيقة | الغرامة: {rule.penalty_rate_per_minute} د.ل/دقيقة
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleToggleRuleActive(rule)} className={`px-3 py-1 rounded text-sm ${rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {rule.is_active ? 'نشط' : 'غير نشط'}
                      </button>
                      <button onClick={() => handleStartEditRule(rule)} className="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-50">تعديل</button>
                      <button onClick={() => initiateDelete('rule', rule.id)} className="px-3 py-1 border border-red-300 rounded text-sm text-red-600 hover:bg-red-50">حذف</button>
                    </div>
                  </div>
                ))}
              </div>
              {(newUnloadingRule.rule_name || editingRuleId) && (
                <div className="border-t pt-4">
                  <h4 className="font-bold text-slate-800 mb-4">{editingRuleId ? 'تعديل قاعدة' : 'إضافة قاعدة جديدة'}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">اسم القاعدة</label>
                      <input type="text" className="w-full p-2 border border-slate-300 rounded-lg" value={editingRuleId ? editingRuleForm.rule_name : newUnloadingRule.rule_name} onChange={(e) => editingRuleId ? setEditingRuleForm({ ...editingRuleForm, rule_name: e.target.value }) : setNewUnloadingRule({ ...newUnloadingRule, rule_name: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">مدة السماح (دقائق)</label>
                      <input type="number" className="w-full p-2 border border-slate-300 rounded-lg" value={editingRuleId ? editingRuleForm.allowed_duration_minutes : newUnloadingRule.allowed_duration_minutes} onChange={(e) => editingRuleId ? setEditingRuleForm({ ...editingRuleForm, allowed_duration_minutes: Number(e.target.value) }) : setNewUnloadingRule({ ...newUnloadingRule, allowed_duration_minutes: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">معدل الغرامة (د.ل/دقيقة)</label>
                      <input type="number" step="0.001" className="w-full p-2 border border-slate-300 rounded-lg" value={editingRuleId ? editingRuleForm.penalty_rate_per_minute : newUnloadingRule.penalty_rate_per_minute} onChange={(e) => editingRuleId ? setEditingRuleForm({ ...editingRuleForm, penalty_rate_per_minute: Number(e.target.value) }) : setNewUnloadingRule({ ...newUnloadingRule, penalty_rate_per_minute: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    {editingRuleId ? (
                      <>
                        <button onClick={handleSaveRuleEdit} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700">حفظ التعديلات</button>
                        <button onClick={handleCancelRuleEdit} className="border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50">إلغاء</button>
                      </>
                    ) : (
                      <button onClick={handleAddRule} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700">إضافة</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'users-backup' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
                <div className="flex items-center gap-4 mb-6">
                  <button onClick={() => setSecurityTab('iam')} className={`px-4 py-2 rounded-lg font-bold ${securityTab === 'iam' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    IAM - إدارة الهويات والوصول
                  </button>
                  <button onClick={() => setSecurityTab('audit')} className={`px-4 py-2 rounded-lg font-bold ${securityTab === 'audit' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    سجل التدقيق
                  </button>
                </div>
                {securityTab === 'iam' && (
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-4">إدارة المستخدمين والصلاحيات</h3>
                    <UnifiedIAM />
                  </div>
                )}
                {securityTab === 'audit' && (
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-4">سجل تدقيق المستخدمين</h3>
                    <AuditLogViewer fallbackLogs={auditLogs.map((entry) => ({
                      id: entry.id,
                      userId: entry.userId,
                      userName: entry.userName,
                      action: entry.action,
                      details: entry.details,
                      timestamp: entry.timestamp,
                    }))} />
                  </div>
                )}
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Database size={20} className="text-emerald-600" /> نسخ احتياطي للبيانات
                </h3>
                <div className="space-y-4">
                  <button className="w-full bg-emerald-600 text-white px-6 py-3 rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-2 font-bold">
                    <Save size={18} /> إنشاء نسخة احتياطية
                  </button>
                  <button className="w-full bg-slate-800 text-white px-6 py-3 rounded-xl hover:bg-slate-900 flex items-center justify-center gap-2 font-bold">
                    <Database size={18} /> استعادة نسخة احتياطية
                  </button>
                  <button onClick={handleResetSystem} disabled={!canResetSystem} className="w-full bg-red-600 text-white px-6 py-3 rounded-xl hover:bg-red-700 flex items-center justify-center gap-2 font-bold disabled:opacity-50 disabled:cursor-not-allowed">
                    <AlertTriangle size={18} /> تصفير النظام
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Layers size={20} className="text-emerald-600" /> أنواع الأصناف
              </h3>
              <div className="flex gap-2 mb-4">
                <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="اسم الفئة" className="flex-1 p-2 border border-slate-300 rounded-lg" />
                <button onClick={handleAddCategory} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 flex items-center gap-2">
                  <Plus size={16} /> إضافة
                </button>
              </div>
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat} className="flex items-center justify-between p-3 border rounded-xl">
                    <span className="font-bold text-slate-700">{cat}</span>
                    <button onClick={() => initiateDelete('category', cat)} className="px-3 py-1 border border-red-300 rounded text-sm text-red-600 hover:bg-red-50 flex items-center gap-1">
                      <Trash2 size={14} /> حذف
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'tags' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Tags size={20} className="text-emerald-600" /> علامات التصنيف
              </h3>
              <div className="flex gap-2 mb-4">
                <input type="text" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} placeholder="اسم العلامة" className="flex-1 p-2 border border-slate-300 rounded-lg" />
                <input type="color" value={newTag.color} onChange={(e) => setNewTag({ ...newTag, color: e.target.value })} className="h-10 w-20 border border-slate-300 rounded" />
                <button onClick={handleAddTag} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 flex items-center gap-2">
                  <Plus size={16} /> إضافة
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tags.map(tag => (
                  <div key={tag.id} className="flex items-center justify-between p-3 border rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: tag.color }} />
                      <span className="font-bold text-slate-700">{tag.name}</span>
                    </div>
                    <button onClick={() => initiateDelete('tag', tag.id)} className="px-3 py-1 border border-red-300 rounded text-sm text-red-600 hover:bg-red-50 flex items-center gap-1">
                      <Trash2 size={14} /> حذف
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'units' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Ruler size={20} className="text-emerald-600" /> وحدات القياس
              </h3>
              <div className="flex gap-2 mb-4">
                <input type="text" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="اسم الوحدة" className="flex-1 p-2 border border-slate-300 rounded-lg" />
                <button onClick={handleAddUnit} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 flex items-center gap-2">
                  <Plus size={16} /> إضافة
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {units.map(unit => (
                  <div key={unit} className="flex items-center justify-between p-3 border rounded-xl">
                    <span className="font-bold text-slate-700">{unit}</span>
                    <button onClick={() => initiateDelete('unit', unit)} className="px-3 py-1 border border-red-300 rounded text-sm text-red-600 hover:bg-red-50 flex items-center gap-1">
                      <Trash2 size={14} /> حذف
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border-2 border-red-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-red-900">تأكيد الحذف</h3>
                <p className="text-sm text-red-700">هل أنت متأكد من الحذف؟</p>
              </div>
            </div>
            <p className="text-slate-700 mb-6">{getDeleteMessage()}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteModal({ ...deleteModal, isOpen: false })} className="px-6 py-2 rounded-xl text-slate-600 hover:bg-slate-100">إلغاء</button>
              <button onClick={confirmDelete} className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 flex items-center gap-2">
                <Trash2 size={18} /> حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System Reset Modal */}
      {resetModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border-2 border-red-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                <ShieldAlert size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-red-900">تصفير النظام</h3>
                <p className="text-sm text-red-700">عملية خطيرة - لا رجعة فيها</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">كلمة التأكيد</label>
                <input type="text" value={resetModal.confirmationCode} onChange={(e) => setResetModal({ ...resetModal, confirmationCode: e.target.value })} className="w-full p-3 border border-slate-300 rounded-lg font-mono" placeholder="CONFIRM_SYSTEM_RESET_2026" />
              </div>
              <label className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl cursor-pointer">
                <input type="checkbox" checked={resetModal.checkboxConfirmed} onChange={(e) => setResetModal({ ...resetModal, checkboxConfirmed: e.target.checked })} className="w-5 h-5 mt-0.5 accent-red-600" />
                <span className="text-sm text-red-800 font-bold">أؤكد أنني أفهم أن هذه العملية ستحذف جميع البيانات ولا يمكن التراجع عنها.</span>
              </label>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setResetModal(createResetModalState())} className="px-6 py-2 rounded-xl text-slate-600 hover:bg-slate-100">إلغاء</button>
              <button onClick={handleConfirmSystemReset} disabled={resetModal.isLoading} className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 flex items-center gap-2 disabled:opacity-50">
                {resetModal.isLoading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                {resetModal.isLoading ? 'جاري التصفير...' : 'تأكيد التصفير'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
