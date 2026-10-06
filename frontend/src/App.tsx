// ENTERPRISE FIX: Phase 3 Final Visual Proof & Cleanup - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 Route Ownership Cleanup - Archive Only - 2026-03-26
// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
// ENTERPRISE FIX: Phase 1 – PostgreSQL Pivot + Zustand Single Source of Truth - 2026-03-13
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Phase 0 – التنظيف الأساسي والأمان الحرج - 2026-03-13
// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import React, { Profiler, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { fetchBackupHealth, type BackupHealth } from './services/backupCenterApi';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { toast } from '@services/toastService';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import EnterpriseLoading from './components/EnterpriseLoading';
import ProtectedRoute from './components/ProtectedRoute';
import { clearLegacyInventoryBootstrapState, useInventoryStore } from './store/useInventoryStore';
import { Transaction, Partner, Order, User, Tag, SystemSettings, OperationAppearance, ReportColumnConfig, Formula, AuditLog } from './types';
import { v4 as uuidv4 } from 'uuid';
import apiClient from '@api/client';
import { clearAllAuthData, logout, setAuthUser } from '@services/authService';
import { filterByDataScope, getIamConfig, hasPermission, logUserActivity, normalizeUsers, upsertCurrentSession } from './services/iamService';
import { isInboundOperationType, isOutboundOperationType } from './utils/operationTypes';
import { recordBootstrapRenderCommit } from '@utils/bootstrapMetrics';
import { useRealtimeSyncStore, type RealtimeScope } from '@/shared/store/realtimeSync.store';
import {
  bulkCreateTransactions,
  deleteTransactionsInApi,
  migrateFromLocalTransactions,
  updateTransactionInApi,
} from '@services/transactionsService';
import {
  getTags, saveTags,
  getAppearanceSettings, saveAppearanceSettings,
  clearStrictEmptyBootFlag,
} from './services/storage';
import { partnersApi } from './services/partnersApi';
import { ordersApi } from './services/ordersApi';
import { migrateLegacyDomains } from './services/domainMigrationService';

import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useOfflineSync } from './hooks/useOfflineSync';
// ENTERPRISE FIX: Phase 1 - Dual Mode Implementation - 2026-03-02
const StockBalances = lazy(() => import('./components/StockBalances'));
const StockCardReport = lazy(() => import('./components/StockCardReport'));
const Statement = lazy(() => import('./components/Statement'));
const Partners = lazy(() => import('./components/Partners'));
const Orders = lazy(() => import('./components/Orders'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const BackupCenterPage = lazy(() => import('./pages/BackupCenter'));
const ItemsPage = lazy(() => import('./pages/Items'));
const OperationsPage = lazy(() => import('./pages/Operations'));
const StocktakingPage = lazy(() => import('./pages/Stocktaking'));
const ReportsPage = lazy(() => import('./pages/Reports'));
const FormulationPage = lazy(() => import('./pages/Formulation'));
const OpeningBalanceRoutePage = lazy(() => import('./pages/OpeningBalancePage'));
const SettingsPage = lazy(() => import('./modules/settings/pages/Settings'));
// DISABLED: AuthenticationPortal - Using LoginV2 only
const LoginV2 = lazy(() => import('./components/LoginV2'));
const AcceptInvitation = lazy(() => import('./components/AcceptInvitation'));
const OperationsPlaceholder = lazy(() => import('./components/OperationsPlaceholder'));
const UnifiedIAM = lazy(() => import('./components/UnifiedIAM'));

const RouteLoadingFallback: React.FC = () => (
  <div className="rounded-xl border border-slate-200 bg-white p-6">
    <div className="animate-pulse space-y-3">
      <div className="h-6 w-48 rounded bg-slate-200" />
      <div className="h-4 w-full rounded bg-slate-100" />
      <div className="h-4 w-11/12 rounded bg-slate-100" />
      <div className="h-4 w-9/12 rounded bg-slate-100" />
    </div>
  </div>
);

const toAuthSessionUser = (user: User) => ({
  id: user.id,
  username: String(user.username || user.email || user.name || user.id),
  role: String(user.role || user.roleId || 'User'),
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  name: String(user.name || user.username || user.email || user.id),
});

const toAuthSessionComparisonKey = (user: User | undefined) => JSON.stringify({
  id: user?.id || '',
  username: String(user?.username || user?.email || user?.name || user?.id || ''),
  role: String(user?.role || user?.roleId || 'User'),
  permissions: Array.isArray(user?.permissions) ? [...user.permissions].sort() : [],
  name: String(user?.name || user?.username || user?.email || user?.id || ''),
});

const handleAppRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration, baseDuration) => {
  recordBootstrapRenderCommit(actualDuration, baseDuration);
};

// ENTERPRISE FIX: Phase 1 - Dual Mode Implementation - 2026-03-02
const AppContent = () => {
  const location = useLocation();
  const { isOffline, isSyncing } = useOfflineSync();
  const items = useInventoryStore((state) => state.items);
  const transactions = useInventoryStore((state) => state.transactions);
  const users = useInventoryStore((state) => state.users);
  const units = useInventoryStore((state) => state.units);
  const categories = useInventoryStore((state) => state.categories);
  const addUnit = useInventoryStore((state) => state.addUnit);
  const deleteUnit = useInventoryStore((state) => state.deleteUnit);
  const addCategory = useInventoryStore((state) => state.addCategory);
  const deleteCategory = useInventoryStore((state) => state.deleteCategory);
  const updateStockFromTransaction = useInventoryStore((state) => state.updateStockFromTransaction);
  const setInventoryTransactions = useInventoryStore((state) => state.setTransactions);
  const setInventoryUsers = useInventoryStore((state) => state.setUsers);
  const loadInventoryCore = useInventoryStore((state) => state.loadInventoryCore);
  const loadTransactions = useInventoryStore((state) => state.loadTransactions);
  const loadFormulas = useInventoryStore((state) => state.loadFormulas);
  const loadUnloadingRules = useInventoryStore((state) => state.loadUnloadingRules);
  const systemSettings = useInventoryStore((state) => state.systemSettings);
  const unloadingRules = useInventoryStore((state) => state.unloadingRules);
  const reportConfig = useInventoryStore((state) => state.reportConfig);
  const openingBalanceReportConfig = useInventoryStore((state) => state.openingBalanceReportConfig);
  const formulas = useInventoryStore((state) => state.formulas);
  const setSystemSettings = useInventoryStore((state) => state.setSystemSettings);
  const setReportConfig = useInventoryStore((state) => state.setReportConfig);
  const setOpeningBalanceReportConfig = useInventoryStore((state) => state.setOpeningBalanceReportConfig);
  const setFormulas = useInventoryStore((state) => state.setFormulas);
  const inventoryStoreLoading = useInventoryStore((state) => state.loading);

  // Core Data
  const [partners, setPartners] = useState<Partner[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  // Settings
  const [appearance, setAppearance] = useState<OperationAppearance[]>([]);

  const [currentUser, setCurrentUser] = useState<User | undefined>(undefined);
  // ENTERPRISE FIX: authReady starts as false
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [inventoryRouteReady, setInventoryRouteReady] = useState(false);
  const deniedAccessLogRef = useRef<Set<string>>(new Set());
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const permissionGuardDebugEnabled = import.meta.env.DEV && String(import.meta.env.VITE_DEBUG_PERMISSION_GUARD || '').trim() === 'true';
  const currentUserId = currentUser?.id;
  const realtimeScopes = useRealtimeSyncStore((state) => state.scopes);
  const lastProcessedRealtimeScopesRef = useRef(realtimeScopes);
  const realtimeSyncInitializedRef = useRef(false);

  const debugPermissionGuard = (...args: unknown[]) => {
    if (permissionGuardDebugEnabled) {
      console.log(...args);
    }
  };

  useEffect(() => {
    setTags(getTags());
    setAppearance(getAppearanceSettings());
    clearLegacyInventoryBootstrapState();
  }, []);

  useAppBootstrap({
    currentUser,
    authReady,
    setCurrentUser,
    setAuthReady,
    setInventoryRouteReady,
  });

  useEffect(() => {
    if (!authReady || !currentUserId) return;
    let active = true;
    void migrateLegacyDomains()
      .catch((error) => console.error('Legacy domain migration failed', error))
      .finally(() => {
        if (!active) return;
        void Promise.all([partnersApi.list(), ordersApi.list()])
          .then(([loadedPartners, loadedOrders]) => {
            if (active) {
              setPartners(loadedPartners);
              setOrders(loadedOrders);
            }
          })
          .catch((error) => console.error('Failed to load server-backed partners/orders', error));
      });
    return () => {
      active = false;
    };
  }, [authReady, currentUserId]);

  useEffect(() => {
    if (users.length > 0 && currentUser) {
      const freshUser = users.find((user) => user.id === currentUser.id);
      if (!freshUser) return;

      const freshPermissions = Array.isArray(freshUser.permissions) ? freshUser.permissions : [];
      const currentPermissions = Array.isArray(currentUser.permissions) ? currentUser.permissions : [];
      const mergedPermissions = freshPermissions.length > 0 ? freshPermissions : currentPermissions;

      const reconciledUser: User = {
        ...freshUser,
        permissions: mergedPermissions,
      };

      if (toAuthSessionComparisonKey(reconciledUser) !== toAuthSessionComparisonKey(currentUser)) {
        setCurrentUser(reconciledUser);
        setAuthUser(toAuthSessionUser(reconciledUser));
      }
    }
  }, [users, currentUser]);

  useEffect(() => {
    if (!authReady || currentUser) return;
    clearAllAuthData();
    setInventoryRouteReady(false);
  }, [authReady, currentUser]);

  useEffect(() => {
    if (!authReady || !currentUserId || !inventoryRouteReady) {
      lastProcessedRealtimeScopesRef.current = realtimeScopes;
      realtimeSyncInitializedRef.current = false;
      return;
    }

    const previousScopes = lastProcessedRealtimeScopesRef.current;
    lastProcessedRealtimeScopesRef.current = realtimeScopes;

    if (!realtimeSyncInitializedRef.current) {
      realtimeSyncInitializedRef.current = true;
      return;
    }

    const changedScopes = (Object.keys(realtimeScopes) as RealtimeScope[]).filter(
      (scope) => realtimeScopes[scope] > previousScopes[scope],
    );

    if (changedScopes.length === 0) {
      return;
    }

    const shouldReloadInventoryCore = changedScopes.includes('items') || changedScopes.includes('transactions');
    const shouldReloadTransactions = changedScopes.includes('transactions');
    const shouldReloadFormulas = changedScopes.includes('formulation');
    const shouldReloadUnloadingRules = changedScopes.includes('settings');

    const reloadTasks: Array<Promise<unknown>> = [];

    if (shouldReloadInventoryCore) {
      reloadTasks.push(loadInventoryCore({ force: true, staleMs: 0 }));
    }

    if (shouldReloadTransactions) {
      reloadTasks.push(loadTransactions({ force: true, staleMs: 0 }));
    }

    if (shouldReloadFormulas) {
      reloadTasks.push(loadFormulas());
    }

    if (shouldReloadUnloadingRules) {
      reloadTasks.push(loadUnloadingRules({ force: true, staleMs: 0 }));
    }

    if (reloadTasks.length === 0) {
      return;
    }

    void Promise.allSettled(reloadTasks).then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('[App] Realtime sync refresh failed:', result.reason);
        }
      });
    });
  }, [
    authReady,
    currentUserId,
    inventoryRouteReady,
    loadFormulas,
    loadInventoryCore,
    loadTransactions,
    loadUnloadingRules,
    realtimeScopes,
  ]);

  // Persist data
  useEffect(() => { if (!authReady) return; saveTags(tags); }, [tags, authReady]);
  useEffect(() => { if (!authReady) return; saveAppearanceSettings(appearance); }, [appearance, authReady]);

  const logAction = (action: AuditLog['action'], entity: AuditLog['entity'], details: string) => {
    if (!currentUser) return;
    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      event: `${String(entity).toLowerCase()}_${String(action).toLowerCase()}`,
      details,
    });
  };

  const denyPermission = (permissionId: string, details: string): boolean => {
    if (hasPermission(currentUser, permissionId)) return false;
    if (currentUser) {
      logUserActivity({ userId: currentUser.id, userName: currentUser.name, event: 'access_denied', details: `${details} - permission=${permissionId}` });
    }
    toast.error('ليس لديك صلاحية الوصول. يرجى التواصل مع مدير النظام.');
    return true;
  };

  const handleAddTransactions = async (newTransactions: Transaction[]) => {
    const hasInbound = newTransactions.some(t => isInboundOperationType(t.type));
    const hasOutbound = newTransactions.some(t => isOutboundOperationType(t.type));

    if (hasInbound && denyPermission('inventory.create.inbound', 'إضافة حركة واردة')) return;
    if (hasOutbound && denyPermission('inventory.create.outbound', 'إضافة حركة صادرة')) return;

    const mapped = newTransactions.map(t => ({
      ...t,
      warehouseId: t.warehouseId ?? currentUser?.scope ?? 'all',
      createdByUserId: t.createdByUserId ?? currentUser?.id,
    }));
    try {
      const created = await bulkCreateTransactions(mapped);
      if (!created.length) return;
      setInventoryTransactions([...transactions, ...created]);
      created.forEach(t => updateStockFromTransaction(t, 'add'));
      logAction('CREATE', 'TRANSACTION', `Added ${created.length} transactions`);
    } catch (error) {
      console.error('Failed to create transactions via API', error);
      toast.error('فشل إضافة الحركات. يرجى التحقق من الاتصال وإعادة المحاولة.');
    }
  };

  const handleDeleteTransactions = async (ids: string[]) => {
    if (denyPermission('inventory.delete.transactions', 'حذف الحركات')) return;
    try {
      await deleteTransactionsInApi(ids);
      const toDelete = transactions.filter(t => ids.includes(t.id));
      toDelete.forEach(t => updateStockFromTransaction(t, 'remove'));
      setInventoryTransactions(transactions.filter(t => !ids.includes(t.id)));
      logAction('DELETE', 'TRANSACTION', `Deleted ${ids.length} transactions`);
    } catch (error) {
      console.error('Failed to delete transactions via API', error);
      toast.error('فشل حذف الحركات. يرجى إعادة المحاولة.');
    }
  };

  const handleUpdateTransaction = async (updated: Transaction) => {
    if (denyPermission('inventory.update.pricing', 'تعديل الحركات')) return;
    const old = transactions.find(t => t.id === updated.id);
    if (!old) return;
    try {
      const saved = await updateTransactionInApi(updated.id, updated);
      updateStockFromTransaction(saved, 'update', old);
      setInventoryTransactions(transactions.map(t => t.id === saved.id ? saved : t));
      logAction('UPDATE', 'TRANSACTION', `Updated transaction ${saved.warehouseInvoice}`);
    } catch (error) {
      console.error('Failed to update transaction via API', error);
      toast.error('فشل تعديل الحركة. يرجى إعادة المحاولة.');
    }
  };

  const handleAddPartner = async (p: Partner) => {
    try {
      const created = await partnersApi.create({ name: p.name, type: p.type, phone: p.phone, address: p.address, notes: p.notes });
      setPartners(prev => [...prev, created]);
      logAction('CREATE', 'Partner', created.name);
    } catch (error) {
      console.error('Failed to create partner', error);
      toast.error('فشل حفظ المورد/العميل.');
    }
  };
  const handleUpdatePartner = async (p: Partner) => {
    try {
      const updated = await partnersApi.update(p.id, { name: p.name, type: p.type, phone: p.phone, address: p.address, notes: p.notes });
      setPartners(prev => prev.map(pa => pa.id === updated.id ? updated : pa));
      logAction('UPDATE', 'Partner', updated.name);
    } catch (error) {
      console.error('Failed to update partner', error);
      toast.error('فشل تحديث المورد/العميل.');
    }
  };
  const handleDeletePartner = async (id: string) => {
    try {
      await partnersApi.remove(id);
      setPartners(prev => prev.filter(p => p.id !== id));
      logAction('DELETE', 'Partner', id);
    } catch (error) {
      console.error('Failed to delete partner', error);
      toast.error('فشل حذف المورد/العميل.');
    }
  };

  const handleAddOrder = async (o: Order) => {
    if (denyPermission('sales.create.orders', 'إضافة طلب بيع')) return;
    const mapped = { ...o, warehouseId: o.warehouseId ?? currentUser?.scope ?? 'all', createdByUserId: o.createdByUserId ?? currentUser?.id };
    try {
      const created = await ordersApi.create(mapped);
      setOrders(prev => [...prev, created]);
      logAction('CREATE', 'ORDER', created.orderNumber);
    } catch (error) {
      console.error('Failed to create order', error);
      toast.error('فشل حفظ الطلب.');
    }
  };
  const handleUpdateOrder = async (o: Order) => {
    if (denyPermission('sales.update.orders', 'تعديل طلب بيع')) return;
    try {
      const updated = await ordersApi.update(o.id, o);
      setOrders(prev => prev.map(order => order.id === updated.id ? updated : order));
      logAction('UPDATE', 'ORDER', updated.orderNumber);
    } catch (error) {
      console.error('Failed to update order', error);
      toast.error('فشل تحديث الطلب.');
    }
  };

  const handleCompleteOrder = async (o: Order) => {
    if (denyPermission('sales.update.orders', 'إكمال طلب بيع')) return;
    try {
      const completed = await ordersApi.complete(o.id, o.warehouseId);
      setOrders(prev => prev.map(order => order.id === completed.id ? completed : order));
      const newTransactions: Transaction[] = completed.items.map(item => ({
        id: uuidv4(),
        date: completed.date,
        warehouseId: completed.warehouseId ?? currentUser?.scope ?? 'all',
        itemId: item.itemId,
        type: completed.type === 'purchase' ? 'وارد' : 'صادر',
        quantity: item.quantity,
        supplierOrReceiver: partners.find(p => p.id === completed.partnerId)?.name || 'Order',
        notes: `From Order #${completed.orderNumber}`,
        timestamp: Date.now(),
        warehouseInvoice: completed.orderNumber
      }));
      await handleAddTransactions(newTransactions);
    } catch (error) {
      console.error('Failed to complete order', error);
      toast.error('فشل إكمال الطلب.');
    }
  };

  const handleAddUser = (u: User) => {
    if (denyPermission('users.create.management', 'إضافة مستخدم')) return;
    setInventoryUsers(normalizeUsers([...users, u]));
  };
  const handleUpdateUser = (u: User) => {
    if (currentUser?.id !== u.id && denyPermission('users.update.management', 'تعديل مستخدم')) return;
    setInventoryUsers(normalizeUsers(users.map(user => user.id === u.id ? u : user)));
    if (currentUser?.id === u.id) {
      logUserActivity({ userId: u.id, userName: u.name, event: 'profile_updated', details: 'تم تحديث الملف الشخصي' });
    }
  };
  const handleDeleteUser = (id: string) => {
    if (denyPermission('users.delete.management', 'حذف مستخدم')) return;
    setInventoryUsers(users.filter(u => u.id !== id));
  };

  useEffect(() => { if (!currentUser) return; upsertCurrentSession(currentUser); }, [currentUser?.id]);

  // FC-SEC-003 — the client-side "switch user" impersonation helper was removed.
  // Changing identity must go through POST /auth/login on the backend.

  const scopedTransactions = filterByDataScope(transactions, currentUser);
  const scopedOrders = filterByDataScope(orders, currentUser);
  const scopedItems = filterByDataScope(items, currentUser);
  const canExportReports = hasPermission(currentUser, 'reports.export.general');
  const canExportInventory = hasPermission(currentUser, 'inventory.export.stock');
  const canImportOperations = hasPermission(currentUser, 'inventory.create.inbound') || hasPermission(currentUser, 'inventory.create.outbound');

  const logDataExport = (module: string, rowCount: number) => {
    if (!currentUser) return;
    logUserActivity({ userId: currentUser.id, userName: currentUser.name, event: 'data_export', details: `تصدير بيانات من ${module} - ${rowCount} سجل` });
  };

  const logDataImport = (module: string, rowCount: number) => {
    if (!currentUser) return;
    logUserActivity({ userId: currentUser.id, userName: currentUser.name, event: 'data_import', details: `استيراد بيانات إلى ${module} - ${rowCount} سجل` });
  };

  // ENTERPRISE FIX: Permission Guard Fixed - 2026-02-26
  // FC-SEC-003 — no auth/permission payloads in production logs.
  const handleAuthenticated = (user: any, redirectTo: string) => {
    const targetUser: User = {
      id: user?.id || `user-${user?.username || 'unknown'}`,
      username: user?.username || 'user',
      role: user?.role || 'User',
      roleId: user?.roleId || 'user',
      permissions: Array.isArray(user?.permissions) ? user.permissions : [],
      name: user?.name || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username,
      email: user?.email || '',
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      isActive: user?.isActive !== false,
      active: user?.active !== false,
      status: user?.status || 'active',
      scope: user?.scope || 'all',
      twoFactorEnabled: user?.twoFactorEnabled ?? false,
      twoFaEnabled: user?.twoFaEnabled ?? false,
      mustChangePassword: user?.mustChangePassword ?? false,
    };

    setInventoryRouteReady(false);
    setCurrentUser(targetUser);
    setAuthUser(toAuthSessionUser(targetUser));
    upsertCurrentSession(targetUser);
    logUserActivity?.({ userId: targetUser.id, userName: targetUser.name, event: 'login_success', details: `${targetUser.role} - ${redirectTo}` });
  };

  const handleLogout = () => {
    if (currentUser) {
      logUserActivity({ userId: currentUser.id, userName: currentUser.name, event: 'sessions_revoked', details: 'تسجيل خروج آمن من النظام' });
    }
    setInventoryRouteReady(false);
    setCurrentUser(undefined);
    void logout();
  };

  // ENTERPRISE FIX: Show EnterpriseLoading until auth is ready
  if (!authReady) {
    return <EnterpriseLoading message="جاري تحميل النظام... يرجى الانتظار" subMessage="يتم تهيئة البيانات والاتصال بالخادم" />;
  }

  const isExplicitInitialSetupPath = typeof window !== 'undefined' && window.location.pathname === '/initial-setup';

  // ENTERPRISE FIX: Keep server-backed login available even when local browser storage has no cached users.
  if (!currentUser && users.length === 0 && isExplicitInitialSetupPath) {
    const handleInitialSetup = async (event: React.FormEvent) => {
      event.preventDefault();
      setSetupMessage('');

      if (!setupName.trim() || !setupEmail.trim() || !setupPassword.trim()) {
        setSetupMessage('يرجى ملء جميع الحقول المطلوبة.');
        return;
      }

      if (setupPassword !== setupPasswordConfirm) {
        setSetupMessage('كلمتا المرور غير متطابقتين. يرجى التأكد وإعادة المحاولة.');
        return;
      }

      try {
        setSetupLoading(true);
        setSetupMessage('');

        // FC-SEC-003 — admin provisioning is a server operation. The password
        // goes straight to the backend, which hashes and stores it.
        const created = await apiClient.post('/auth/setup', {
          firstName: setupName.trim(),
          email: setupEmail.trim(),
          username: setupEmail.trim().split('@')[0] || setupName.trim(),
          password: setupPassword,
        });

        const createdUser = created.data as {
          id: string;
          username: string;
          email: string;
          firstName?: string;
          lastName?: string;
          role: string;
          roleId: string;
        };

        clearStrictEmptyBootFlag();
        setInventoryUsers(normalizeUsers([...users, createdUser as unknown as User]));
        setSetupMessage('تم إنشاء حساب المدير. يرجى تسجيل الدخول الآن.');
      } catch (error: any) {
        setSetupMessage(
          error?.response?.data?.message || 'فشل إنشاء الحساب. يرجى إعادة المحاولة.',
        );
      } finally {
        setSetupLoading(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-xl font-bold text-slate-800">إعداد النظام لأول مرة</h2>
          <p className="text-sm text-slate-600">مرحباً بك في نظام مصنع الأعلاف. يرجى إنشاء حساب المدير للبدء. هذا الحساب سيكون له صلاحيات كاملة على النظام.</p>

          <form onSubmit={handleInitialSetup} className="space-y-3">
            <input type="text" value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="الاسم الكامل" className="w-full p-2 border rounded-lg" />
            <input type="email" value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} placeholder="البريد الإلكتروني (اختياري)" className="w-full p-2 border rounded-lg" />
            <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="كلمة المرور" className="w-full p-2 border rounded-lg" />
            <input type="password" value={setupPasswordConfirm} onChange={(e) => setSetupPasswordConfirm(e.target.value)} placeholder="تأكيد كلمة المرور" className="w-full p-2 border rounded-lg" />
            <button type="submit" disabled={setupLoading} className="w-full bg-slate-900 text-white py-2 rounded-lg disabled:opacity-60">
              {setupLoading ? 'جاري الإنشاء...' : 'إنشاء الحساب والبدء'}
            </button>
          </form>

          {setupMessage && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{setupMessage}</div>}
        </div>
      </div>
    );
  }

  const isAcceptInvitationPath = typeof window !== 'undefined' && window.location.pathname === '/accept-invitation';
  if (!currentUser && isAcceptInvitationPath) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <AcceptInvitation />
      </Suspense>
    );
  }

  // ENTERPRISE FIX: Show LoginV2 only
  if (!currentUser) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <LoginV2 onAuthenticated={handleAuthenticated} />
      </Suspense>
    );
  }

  const renderProtectedRoute = (permissionId: string, routeId: string, element: React.ReactNode) => {
    if (!inventoryRouteReady || inventoryStoreLoading) {
      return (
        <EnterpriseLoading
          message="جاري تحميل بيانات المخزون..."
          subMessage="يتم تهيئة حالة التطبيق بعد تسجيل الدخول"
        />
      );
    }

    if (currentUser?.permissions?.includes('*')) {
      debugPermissionGuard(`[Permission Guard] Wildcard permission granted to ${routeId}`);
      return element;
    }

    const permissions = currentUser?.permissions || [];
    debugPermissionGuard(`[Permission Guard] Checking ${routeId} with permissions:`, permissions);

    return (
      <ProtectedRoute
        permission={permissionId}
        fallback={(
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-800 font-bold">
            {(() => {
              if (currentUser) {
                const deniedKey = `${currentUser.id}:${routeId}:${permissionId}`;
                if (!deniedAccessLogRef.current.has(deniedKey)) {
                  deniedAccessLogRef.current.add(deniedKey);
                  logUserActivity({ userId: currentUser.id, userName: currentUser.name, event: 'access_denied', details: `تم رفض الوصول إلى ${routeId} - permission=${permissionId}` });
                }
              }

              return 'ليس لديك صلاحية الوصول لهذه الصفحة. يرجى التواصل مع مدير النظام للحصول على الصلاحيات المناسبة.';
            })()}
          </div>
        )}
      >
        {element}
      </ProtectedRoute>
    );
  };

  const handleAddTag = (t: Tag) => setTags(prev => [...prev, t]);
  const handleDeleteTag = (id: string) => setTags(prev => prev.filter(t => t.id !== id));
  const handleUpdateSettings = (s: SystemSettings) => setSystemSettings(s);
  const handleUpdateAppearance = (a: OperationAppearance[]) => setAppearance(a);
  const handleUpdateReportConfig = (c: ReportColumnConfig[]) => setReportConfig(c);
  const handleAddFormula = (f: Formula) => { setFormulas([...formulas, f]); logAction('CREATE', 'FORMULA', f.name); };
  const handleUpdateFormula = (f: Formula) => { setFormulas(formulas.map(fo => fo.id === f.id ? f : fo)); logAction('UPDATE', 'FORMULA', f.name); };
  const handleDeleteFormula = (id: string) => { setFormulas(formulas.filter(f => f.id !== id)); logAction('DELETE', 'FORMULA', id); };

  const withLazyFallback = (element: React.ReactNode) => (
    <Suspense fallback={<RouteLoadingFallback />}>{element}</Suspense>
  );

  // ENTERPRISE FIX: Phase 1 - Dual Mode Implementation - Offline Indicator
  const OfflineBanner = () => {
    if (!isOffline && !isSyncing) return null;
    return (
      <div style={{ backgroundColor: isOffline ? '#f59e0b' : '#3b82f6', color: 'white', padding: '8px', textAlign: 'center', fontWeight: 'bold', zIndex: 9999, position: 'relative' }}>
        {isOffline ? '⚠️ أنت الآن في وضع أوفلاين (بدون اتصال). التعديلات محفوظة محلياً.' : '⏳ جاري مزامنة التعديلات مع الخادم...'}
      </div>
    );
  };

  // B5 — the backup health warning, beside the offline banner.
  //
  // This is the one place an operator is guaranteed to look, which is exactly why the
  // absence of a warning here was the worst of the three gaps. A schedule that had
  // silently stopped for a month looked identical to a schedule that had never
  // failed, on every screen, and the only evidence would have been the `lastRunAt`
  // field on a page nobody opens.
  //
  // Reads the same endpoint the dashboard and the reset screen read, so the three
  // cannot say different things about the same archive. It is not polled on a timer:
  // the endpoint memoises for half a minute, and a banner that re-asks on every
  // keystroke would be a banner that flickers.
  //
  // Only shown to someone who holds `backup.view`, and only when there is something to
  // say. A permanent green banner is noise, and noise is why real warnings get
  // dismissed.
  const BackupHealthBanner = () => {
    const [health, setHealth] = useState<BackupHealth | null>(null);
    const canSeeBackups = hasPermission(currentUser, 'backup.view');

    useEffect(() => {
      if (!canSeeBackups) return;
      let cancelled = false;
      void fetchBackupHealth().then((answer) => {
        if (!cancelled) setHealth(answer);
      });
      return () => {
        cancelled = true;
      };
    }, [canSeeBackups]);

    if (!canSeeBackups || !health) return null;
    if (health.verdict === 'ok') return null;

    const error = health.verdict === 'unhealthy' || health.verdict === 'none';
    const message =
      health.problems.find((problem) => problem.severity === 'error')?.message ?? health.summary;

    return (
      <div
        role="status"
        style={{
          backgroundColor: error ? '#dc2626' : '#d97706',
          color: 'white',
          padding: '8px',
          textAlign: 'center',
          fontWeight: 'bold',
          zIndex: 9999,
          position: 'relative',
        }}
      >
        <span>تنبيه حماية البيانات: </span>
        <span>{message}</span>
        <span> — </span>
        <a href="/backup" style={{ color: 'white', textDecoration: 'underline' }}>
          افتح مركز النسخ الاحتياطية
        </a>
      </div>
    );
  };

  // ENTERPRISE FIX: Routes without BrowserRouter (already in index.tsx)
  return (
    <>
      <OfflineBanner />
      <BackupHealthBanner />
      <Layout currentUser={currentUser} onLogout={handleLogout}>
      <Routes key={location.pathname}>
        <Route path="/" element={renderProtectedRoute('inventory.view.stocktaking', 'dashboard', withLazyFallback(<DashboardPage />))} />
        <Route path="/dashboard" element={renderProtectedRoute('inventory.view.stocktaking', 'dashboard', withLazyFallback(<DashboardPage />))} />
        <Route path="/balances" element={renderProtectedRoute('inventory.view.stocktaking', 'balances', withLazyFallback(<StockBalances settings={systemSettings} />))} />
        <Route path="/operations" element={renderProtectedRoute('transactions.view', 'operations', withLazyFallback(<OperationsPage />))} />
        <Route path="/transactions" element={renderProtectedRoute('transactions.view', 'operations', withLazyFallback(<OperationsPage />))} />
        <Route path="/items" element={renderProtectedRoute('items.view', 'items', withLazyFallback(<ItemsPage />))} />
        <Route path="/stocktaking" element={renderProtectedRoute('inventory.view.stocktaking', 'stocktaking', withLazyFallback(<StocktakingPage />))} />
        <Route path="/stock-card" element={renderProtectedRoute('reports.view', 'stock-card', withLazyFallback(<StockCardReport items={scopedItems} transactions={scopedTransactions} companyName={systemSettings.companyName} companyAddress={systemSettings.address} companyPhone={systemSettings.phone} canExport={canExportInventory} onExport={(rowCount) => logDataExport('stock-card', rowCount)} />))} />
        <Route
          path="/statement"
          element={renderProtectedRoute(
            'reports.view',
            'statement',
            withLazyFallback(
              <Statement
                items={scopedItems}
                transactions={scopedTransactions}
                settings={systemSettings}
                unloadingRules={unloadingRules}
                currentUserId={currentUser?.id}
                canExport={canExportInventory}
                onExport={(rowCount) => logDataExport('statement', rowCount)}
              />
            )
          )}
        />
        <Route path="/partners" element={renderProtectedRoute('partners.view', 'partners', withLazyFallback(<Partners partners={partners} onAddPartner={handleAddPartner} onUpdatePartner={handleUpdatePartner} onDeletePartner={handleDeletePartner} transactions={scopedTransactions} orders={scopedOrders} />))} />
        <Route path="/orders" element={renderProtectedRoute('sales.view.orders', 'orders', withLazyFallback(<Orders orders={scopedOrders} partners={partners} items={scopedItems} onAddOrder={handleAddOrder} onUpdateOrder={handleUpdateOrder} onCompleteOrder={handleCompleteOrder} />))} />
        <Route path="/reports" element={renderProtectedRoute('reports.view', 'reports', withLazyFallback(<ReportsPage />))} />
        <Route path="/formulation" element={renderProtectedRoute('formulation.view', 'formulation', withLazyFallback(<FormulationPage />))} />
        <Route path="/opening-balance" element={renderProtectedRoute('opening-balances.view', 'opening-balance', withLazyFallback(<OpeningBalanceRoutePage />))} />
        <Route
          path="/settings"
          element={renderProtectedRoute(
            'settings.view.general',
            'settings',
            withLazyFallback(
              <SettingsPage
                settings={systemSettings}
                onUpdateSettings={handleUpdateSettings}
                reportConfig={reportConfig}
                onUpdateReportConfig={handleUpdateReportConfig}
                openingBalanceReportConfig={openingBalanceReportConfig}
                onUpdateOpeningBalanceReportConfig={setOpeningBalanceReportConfig}
                currentUser={currentUser}
              />
            )
          )}
        />
        <Route
          path="/users"
          element={renderProtectedRoute(
            'users.view',
            'users',
            withLazyFallback(<UnifiedIAM />)
          )}
        />
        <Route path="/backup" element={renderProtectedRoute('backup.view', 'backup', withLazyFallback(<BackupCenterPage currentUser={currentUser} />))} />
        <Route path="*" element={renderProtectedRoute('inventory.view.stocktaking', 'fallback-dashboard', withLazyFallback(<DashboardPage />))} />
      </Routes>
    </Layout>
    </>
  );
};

const App: React.FC = () => {
  const content = import.meta.env.DEV ? (
    <Profiler id="AppShell" onRender={handleAppRender}>
      <AppContent />
    </Profiler>
  ) : (
    <AppContent />
  );

  return (
    <ErrorBoundary>
      {content}
      <Toaster position="top-left" richColors closeButton />
    </ErrorBoundary>
  );
};

if (import.meta.env.DEV) {
  (AppContent as typeof AppContent & { whyDidYouRender?: boolean }).whyDidYouRender = true;
  (App as typeof App & { whyDidYouRender?: boolean }).whyDidYouRender = true;
}

export default App;
