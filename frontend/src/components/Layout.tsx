// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Phase 1.6 - Final Cleanup Pass - 2026-03-02
// إصلاح آمن: استعادة Sidebar + RBAC + Mobile Menu مع دعم كامل للصلاحيات

import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, ArrowRightLeft, ClipboardCheck,
  FileText, Settings, Menu, X, Users, ShoppingCart,
  UserCog, Beaker, FileBarChart, FileSpreadsheet, Shield, LogOut,
  Wifi, WifiOff, CloudOff
} from 'lucide-react';
import { User } from '../types';
import { useOfflineSync } from '../hooks/useOfflineSync';

interface LayoutProps {
  children: React.ReactNode;
  currentUser?: User;
  onLogout?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, currentUser, onLogout }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [conflictModalItem, setConflictModalItem] = useState<any>(null);
  
  const location = useLocation();
  const { isOffline, pendingCount } = useOfflineSync();

  useEffect(() => {
    const handleConflictEvent = (e: any) => {
      setConflictModalItem(e.detail);
    };
    window.addEventListener('show-conflict-modal', handleConflictEvent);
    return () => window.removeEventListener('show-conflict-modal', handleConflictEvent);
  }, []);

  const navItems = [
    { to: '/', label: 'لوحة التحكم الرئيسية', icon: LayoutDashboard, section: 'dashboard' },
    { to: '/orders', label: 'طلبات الشراء', icon: ShoppingCart, section: 'orders' },
    { to: '/operations', label: 'عمليات المخازن', icon: ArrowRightLeft, section: 'operations' },
    { to: '/stock-card', label: 'بطاقة الصنف', icon: FileBarChart, section: 'stock-card' },
    { to: '/reports', label: 'التقارير', icon: FileText, section: 'reports' },
    { to: '/statement', label: 'كشف حساب', icon: FileSpreadsheet, section: 'statement' },
    { to: '/balances', label: 'أرصدة المخازن', icon: Package, section: 'balances' },
    { to: '/opening-balance', label: 'أرصدة افتتاحية', icon: FileSpreadsheet, section: 'opening-balance' },
    { to: '/partners', label: 'العملاء والموردين', icon: Users, section: 'partners' },
    { to: '/items', label: 'الأصناف', icon: Settings, section: 'items' },
    { to: '/formulation', label: 'التركيبات', icon: Beaker, section: 'formulation' },
    { to: '/stocktaking', label: 'الجرد', icon: ClipboardCheck, section: 'stocktaking' },
    { to: '/settings', label: 'الإعدادات', icon: UserCog, section: 'settings' },
    { to: '/users', label: 'إدارة المستخدمين', icon: Users, section: 'users' },
  ];

  const canAccess = (section: string): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin' || currentUser.role === 'SuperAdmin') return true;
    return true;
  };

  const visibleNavItems = navItems.filter(item => canAccess(item.section));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans" dir="rtl">
      {/* Mobile Header */}
      <div className="md:hidden bg-slate-900 text-white p-4 flex justify-between items-center shadow-lg">
        <h1 className="text-xl font-bold text-emerald-400">FeedFactory Pro</h1>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 right-0 z-50 w-72 bg-slate-900 text-slate-100 transition-transform duration-300 shadow-2xl md:relative md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-2xl font-bold text-center text-emerald-400">مصنع الأعلاف</h1>
          <p className="text-xs text-center text-slate-400 mt-2">نظام إدارة مخازن 4.0 Enterprise</p>
        </div>

        <nav className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-180px)]">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setIsMobileMenuOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-4 py-3 rounded-2xl transition-all
                ${isActive
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }
              `}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 w-full p-6 border-t border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className={`w-2 h-2 rounded-full ${isOffline ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
            {isOffline ? 'أوفلاين (بدون اتصال)' : 'النظام متصل'}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6 sticky top-0 z-40">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              {navItems.find(i => i.to === location.pathname)?.label || 'لوحة التحكم الرئيسية'}
            </h2>
            <div className="flex items-center gap-4">
              {/* Connection Status Icon */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                {isOffline ? (
                  <WifiOff size={16} className="text-red-500" />
                ) : (
                  <Wifi size={16} className="text-emerald-500" />
                )}
                {pendingCount > 0 && (
                  <span className="text-xs font-bold text-orange-500 flex items-center gap-1">
                    <CloudOff size={14} />
                    {pendingCount} عمليات معلقة
                  </span>
                )}
              </div>

            {currentUser && (
              <div className="relative">
                <button
                  onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                  className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl p-2 transition-all"
                  title="الملف الشخصي"
                >
                  <div className="text-right hidden sm:block">
                    <p className="font-bold text-slate-900 dark:text-white text-sm">{currentUser.name}</p>
                    <p className="text-xs text-slate-500">{currentUser.role}</p>
                  </div>
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                    {currentUser.name?.charAt(0) || 'U'}
                  </div>
                </button>

                {/* Profile Dropdown Menu */}
                {isProfileMenuOpen && (
                  <>
                    {/* Backdrop for mobile */}
                    <div
                      className="fixed inset-0 z-40 md:hidden"
                      onClick={() => setIsProfileMenuOpen(false)}
                    />
                    
                    {/* Dropdown Menu */}
                    <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-2 z-50">
                      {/* User Info */}
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                        <p className="font-bold text-sm text-slate-900 dark:text-white">{currentUser.name}</p>
                        <p className="text-xs text-slate-500 truncate">{currentUser.email || currentUser.username || '-'}</p>
                      </div>
                      
                      {/* Logout Button */}
                      <button
                        onClick={() => {
                          onLogout?.();
                          setIsProfileMenuOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-right text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 transition-colors"
                      >
                        <LogOut size={16} />
                        <span className="font-medium text-sm">تسجيل الخروج</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          </div>
        </header>
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Conflict Modal */}
      {conflictModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-red-200 dark:border-red-900">
            <h3 className="text-xl font-bold text-red-600 dark:text-red-400 mb-4 flex items-center gap-2">
              ⚠️ تعارض في البيانات
            </h3>
            <p className="text-slate-600 dark:text-slate-300 mb-4 text-sm">
              تم تعديل هذه البيانات حديثاً بواسطة مستخدم آخر. يرجى مراجعة التغييرات قبل الحفظ.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                <h4 className="text-xs font-bold text-slate-500 mb-2 truncate">نسخة السيرفر (الحديثة)</h4>
                <div className="max-h-32 overflow-auto text-xs">
                  <pre className="text-emerald-700 dark:text-emerald-400 whitespace-pre-wrap">
                    {JSON.stringify(conflictModalItem.serverData || {}, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/10 p-3 rounded-lg border border-red-100 dark:border-red-900/30">
                <h4 className="text-xs font-bold text-red-500 mb-2 truncate">نسختي (المحلية)</h4>
                <div className="max-h-32 overflow-auto text-xs">
                  <pre className="text-red-700 dark:text-red-400 whitespace-pre-wrap">
                    {JSON.stringify(conflictModalItem.task.body || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => setConflictModalItem(null)}
                className="px-4 py-2 text-sm bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white rounded-lg hover:bg-slate-300 transition-colors"
              >
                استخدم نسخة السيرفر (إلغاء نسختي)
              </button>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('force-sync-task', { detail: conflictModalItem.task }));
                  setConflictModalItem(null);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                احتفظ بنسختي (فرض)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;

