// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import { ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { useOfflineSync } from '@hooks/useOfflineSync';
import { useInventoryStore } from '../../../store/useInventoryStore';

interface OfflineSettingsProps {
  forceAccess?: boolean;
}

const OfflineSettings: React.FC<OfflineSettingsProps> = ({ forceAccess = false }) => {
  const { hasPermission } = usePermissions();
  const { isOffline, isSyncing } = useOfflineSync();
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
  const syncing = useInventoryStore((state) => state.syncing);
  const error = useInventoryStore((state) => state.error);

  if (!forceAccess && !hasPermission('settings.view.offline')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض إعدادات الأوفلاين</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.offline</code>.</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 font-black text-slate-900">{isOffline ? <WifiOff /> : <Wifi />} حالة الاتصال</div>
        <div className="mt-4 text-2xl font-black text-slate-900">{isOffline ? 'أوفلاين' : 'متصل'}</div>
        <div className="mt-2 text-sm text-slate-500">{isSyncing ? 'تجري مزامنة التعديلات.' : 'لا توجد مزامنة نشطة الآن.'}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="font-black text-slate-900">آخر تحميل من الخادم</div>
        <div className="mt-4 text-lg font-semibold text-slate-800">{lastLoadedAt ? new Date(lastLoadedAt).toLocaleString('ar-EG') : 'لم يتم التحميل بعد'}</div>
        <div className="mt-2 text-sm text-slate-500">حالة المزامنة الداخلية: {syncing ? 'نشطة' : 'متوقفة'}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="font-black text-slate-900">تنبيهات</div>
        <div className="mt-4 text-sm text-slate-700">{error || 'لا توجد أخطاء مزامنة حالية.'}</div>
      </div>
    </div>
  );
};

export default OfflineSettings;