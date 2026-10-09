// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { useOfflineSync } from '@hooks/useOfflineSync';
import { useInventoryStore } from '../../../store/useInventoryStore';
import { formatDateTime } from '@services/dateFormat';
import type { MutationTask } from '../../../services/mutationQueueService';

interface OfflineSettingsProps {
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار الإرسال',
  processing: 'قيد الإرسال',
  failed: 'فشل',
  conflict: 'تعارض',
  blocked: 'مرفوضة من الخادم',
  'dead-letter': 'متوقفة نهائيًا',
};

const OfflineSettings: React.FC<OfflineSettingsProps> = ({ }) => {
  const { hasPermission } = usePermissions();
  const { isOffline, isSyncing, pendingCount, blockedCount, totalCount, conflictCount, failedCount, deadLetterCount, retryFailed, queueTasks } = useOfflineSync();
  // Gate 4.8 - this button re-sends whatever the session queued elsewhere, across
  // every endpoint it ever touched. It used to sit behind `settings.view.general`,
  // the same *read* key that opens this whole tab, so the weakest permission in the
  // section controlled a control that writes. The server still refuses what the
  // holder is not permitted to do, so this is not privilege escalation — but a
  // panel gated on read offering a control that writes is a gate that says one thing
  // and does another.
  const canRetry = hasPermission('settings.update.system');
  // The button retries `failed`, `conflicts` and `dead-letter`. A queue holding only
  // `blocked` tasks has nothing retryable in it, so an enabled button here promised an
  // action and silently did none — the worst state for a button labelled "retry all".
  const retryableCount = conflictCount + failedCount + deadLetterCount;
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
  const syncing = useInventoryStore((state) => state.syncing);
  // Gate 4.7 - the inventory store's error is a *load* failure (a failed items or
  // transactions fetch), not a sync failure. Rendering it here as a sync alert
    // pointed the operator at the queue when the queue was fine.
  const loadError = useInventoryStore((state) => state.error);
  const [tasks, setTasks] = useState<MutationTask[]>([]);

  // Gate 4.8 - the panel told an operator "a permission is missing" without saying
  // which. There was no task list in the whole app: `getQueue()` existed and nothing
  // rendered it. The queue is read here so the count above and the list below agree,
  // and so a blocked row names the URL the server actually refused.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await queueTasks();
        if (!cancelled) setTasks(rows);
      } catch (error) {
        console.error('Failed to read the mutation queue:', error);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [queueTasks, totalCount, isSyncing]);

  if (!hasPermission('settings.view.general')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض إعدادات الأوفلاين</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.general</code>.</div>
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
        <div className="mt-4 text-lg font-semibold text-slate-800">{lastLoadedAt ? formatDateTime(lastLoadedAt) : 'لم يتم التحميل بعد'}</div>
        <div className="mt-2 text-sm text-slate-500">حالة المزامنة الداخلية: {syncing ? 'نشطة' : 'متوقفة'}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="font-black text-slate-900">تنبيهات</div>
        <div className="mt-4 text-sm text-slate-700">{loadError || 'لا توجد مهام عالقة. المهام المرفوضة أو المتوقفة نهائيًا تُعرض أعلاه بسببها.'}</div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-black text-slate-900">طابور العمليات غير الملتزم</div>
            <div className="mt-2 text-sm text-slate-500">
              {totalCount} مهمة في الطابور: {pendingCount} بانتظار الإرسال، {conflictCount} تعارض، {failedCount} فشل، {deadLetterCount} متوقفة نهائيًا
            </div>
            {blockedCount > 0 && (
              <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <strong>{blockedCount}</strong> مهمة رفضها الخادم (صلاحية غير متوفرة).
                لن تُرسل بإعادة المحاولة — يلزم تغيير الصلاحية أولاً، وإلا فستبقى محفوظة بانتظار قرار.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void retryFailed()}
            disabled={!canRetry || isSyncing || retryableCount === 0}
            title={!canRetry
              ? 'يلزم صلاحية تعديل إعدادات النظام (settings.update.system) لإعادة الإرسال'
              : retryableCount === 0 ? 'لا توجد مهام قابلة لإعادة المحاولة' : undefined}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            <RefreshCw size={16} />
            إعادة محاولة الكل ({retryableCount})
          </button>
        </div>

        {tasks.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="p-2 font-bold">العملية</th>
                  <th className="p-2 font-bold">الوجهة</th>
                  <th className="p-2 font-bold">الحالة</th>
                  <th className="p-2 font-bold">المحاولات</th>
                  <th className="p-2 font-bold">رفض الخادم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="p-2 text-slate-700">{task.operation}</td>
                    <td className="p-2 font-mono text-slate-600" dir="ltr">{task.method} {task.url}</td>
                    <td className="p-2 text-slate-700">{STATUS_LABELS[task.status] ?? task.status}</td>
                    <td className="p-2 text-slate-600">{task.attempts}</td>
                    <td className="p-2 text-red-700">{task.lastError || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfflineSettings;