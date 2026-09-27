import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from '@services/toastService';
import { usePermissions } from '@hooks/usePermissions';
import { useRealtimeSyncStore } from '@/shared/store/realtimeSync.store';
import {
  stockDeficitApi,
  type StockDeficitRow,
  type StockDeficitStatus,
} from '@services/stockDeficitApi';
import { formatNumber } from './shared';

/**
 * FC-DEF-001 — the deficit queue.
 *
 * A deficit is a recorded shortfall: an issue was posted that the balance could
 * not cover, the balance was clamped at zero, and the difference was kept as
 * debt instead of being silently dropped. This screen is the other half of that
 * promise, because an alert nobody can open is not an alert.
 *
 * The two actions are deliberately not equivalent. A write-off accepts the
 * shortfall as a loss and needs a written reason plus a separate permission,
 * because it is the only way to close a debt without a movement. Reopening is
 * only meaningful for a written-off row: a debt settled by a receipt is settled.
 */

const STATUS_LABELS: Record<StockDeficitStatus, string> = {
  OPEN: 'مفتوح',
  SETTLED_BY_RECEIPT: 'سُوِّي بوارد',
  SETTLED_BY_CORRECTION: 'سُوِّي بتصحيح',
  WRITTEN_OFF: 'مُشطب',
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'OPEN', label: 'المفتوحة' },
  { value: 'ALL', label: 'الكل' },
  { value: 'WRITTEN_OFF', label: 'المشطوبة' },
];

const ageInDays = (createdAt: string): number => {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
};

const statusTone = (status: StockDeficitStatus): string => {
  if (status === 'OPEN') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'WRITTEN_OFF') return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
};

const StockDeficitQueue: React.FC = () => {
  const { can } = usePermissions();
  const canResolve = can.resolveStockDeficits;

  const [status, setStatus] = useState('OPEN');
  const [rows, setRows] = useState<StockDeficitRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [openQuantity, setOpenQuantity] = useState('0');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<StockDeficitRow | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await stockDeficitApi.list({ status: nextStatus, limit: 100 });
      setRows(response.data);
      setOpenCount(response.openCount);
      setOpenQuantity(String(response.openQuantity ?? '0.000'));
    } catch (caught: any) {
      // A queue that silently shows nothing is the failure mode this whole
      // feature exists to prevent, so the error is shown rather than swallowed.
      setError(caught?.response?.data?.message || 'تعذّر تحميل قائمة العجز');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  // FC-DEF-001 — the server announces a new shortfall as `stock.deficit-recorded`
  // with conflict: true. Without a subscriber that event goes to a socket nobody
  // is listening on, and the alert only surfaces the next time an operator
  // happens to open this page, which is the silence the deficit ledger was
  // built to end. The stocktaking scope counter is what the sync store bumps
  // for any inventory event, so watching it refreshes on a real change rather
  // than on a timer.
  const stocktakingVersion = useRealtimeSyncStore((state) => state.scopes.stocktaking);
  const lastReason = useRealtimeSyncStore((state) => state.lastReason);
  const previousVersion = useRef(stocktakingVersion);

  useEffect(() => {
    const changed = previousVersion.current !== stocktakingVersion;
    previousVersion.current = stocktakingVersion;
    if (!changed) return;
    void load(status);
    if (lastReason === 'stock.deficit-recorded') {
      toast.warning('تم تسجيل عجز مخزون جديد، راجع طابور العجز');
    }
  }, [stocktakingVersion, lastReason, load, status]);

  const submitWriteOff = useCallback(async () => {
    if (!writeOffTarget) return;
    const reason = writeOffReason.trim();
    if (reason.length < 10) {
      toast.error('سبب الإشطبان لا يقل عن ١٠ أحرف');
      return;
    }
    setBusyId(writeOffTarget.publicId);
    try {
      await stockDeficitApi.writeOff(writeOffTarget.publicId, reason);
      toast.success('تم إشطبان العجز');
      setWriteOffTarget(null);
      setWriteOffReason('');
      await load(status);
    } catch (caught: any) {
      toast.error(caught?.response?.data?.message || 'تعذّر إشطبان العجز');
    } finally {
      setBusyId(null);
    }
  }, [writeOffTarget, writeOffReason, load, status]);

  const reopen = useCallback(async (row: StockDeficitRow) => {
    setBusyId(row.publicId);
    try {
      await stockDeficitApi.reopen(row.publicId);
      toast.success('تم إعادة فتح العجز');
      await load(status);
    } catch (caught: any) {
      toast.error(caught?.response?.data?.message || 'تعذّرت إعادة الفتح');
    } finally {
      setBusyId(null);
    }
  }, [load, status]);

  const totalOpen = useMemo(
    () => (Number(openCount) > 0 ? `لديك ${openCount} عجز مفتوح بقيمة ${formatNumber(Number(openQuantity))}` : 'لا يوجد عجز مفتوح'),
    [openCount, openQuantity],
  );

  return (
    <section className="space-y-4" data-testid="stock-deficit-queue" aria-label="طابور عجز المخزون">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className={Number(openCount) > 0 ? 'text-red-600' : 'text-emerald-600'} size={20} />
          <h2 className="text-lg font-bold text-slate-800">عجز المخزون</h2>
        </div>
        <div className="flex items-center gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
              className={`px-3 py-1 rounded text-sm ${status === filter.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {filter.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(status)}
            className="px-3 py-1 rounded text-sm bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            تحديث
          </button>
        </div>
      </header>

      <p className={`text-sm ${Number(openCount) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{totalOpen}</p>

      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-right">الصنف</th>
              <th className="px-3 py-2 text-right">العجز</th>
              <th className="px-3 py-2 text-right">الحالة</th>
              <th className="px-3 py-2 text-right">العمر (يوم)</th>
              <th className="px-3 py-2 text-right">ملاحظة</th>
              {canResolve && <th className="px-3 py-2 text-right">إجراء</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canResolve ? 6 : 5} className="px-3 py-6 text-center text-slate-500">جاري التحميل...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={canResolve ? 6 : 5} className="px-3 py-6 text-center text-slate-500">لا توجد سجلات</td></tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.publicId}
                className="border-t border-slate-100"
                data-testid={`deficit-${row.publicId}`}
                data-deficit-item={row.itemId}
              >
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{row.itemName}</div>
                  {row.itemCode && <div className="text-xs text-slate-500">{row.itemCode}</div>}
                </td>
                <td className="px-3 py-2 font-bold text-red-700">
                  {formatNumber(Number(row.quantity))} {row.unit || ''}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded border text-xs ${statusTone(row.status)}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{ageInDays(row.createdAt)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {row.status === 'OPEN' ? row.reason : row.resolution}
                </td>
                {canResolve && (
                  <td className="px-3 py-2">
                    {row.status === 'OPEN' && (
                      <button
                        type="button"
                        disabled={busyId === row.publicId}
                        onClick={() => { setWriteOffTarget(row); setWriteOffReason(''); }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={14} /> إشطبان
                      </button>
                    )}
                    {row.status === 'WRITTEN_OFF' && (
                      <button
                        type="button"
                        disabled={busyId === row.publicId}
                        onClick={() => void reopen(row)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RotateCcw size={14} /> إعادة فتح
                      </button>
                    )}
                    {row.status.startsWith('SETTLED') && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 size={14} /> تسوية آلية
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!canResolve && (
        <p className="text-xs text-slate-500">
          <AlertTriangle size={12} className="inline" /> صلاحية <code>inventory.adjust.stock</code> مطلوبة لإشطبان عجز.
        </p>
      )}

      {writeOffTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-800 mb-2">إشطبان عجز</h3>
            <p className="text-sm text-slate-600 mb-3">
              {writeOffTarget.itemName} — {formatNumber(Number(writeOffTarget.quantity))} {writeOffTarget.unit || ''}
            </p>
            <p className="text-xs text-slate-500 mb-3">
              الإشطبان يعني اعترافاً بأن هذه الكمية مفقودة نهائياً. سيُسجَّل في دفتر الحركات كتصحيح، ويبقى الجرد عند الصفر لأن البضاعة لم تصل.
            </p>
            <textarea
              value={writeOffReason}
              onChange={(event) => setWriteOffReason(event.target.value)}
              rows={3}
              placeholder="سبب الإشطبان (١٠ أحرف على الأقل)"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => { setWriteOffTarget(null); setWriteOffReason(''); }}
                className="px-3 py-1.5 rounded border border-slate-300 text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void submitWriteOff()}
                disabled={busyId === writeOffTarget.publicId}
                className="px-3 py-1.5 rounded bg-red-700 text-white disabled:opacity-50"
              >
                تأكيد الإشطبان
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default StockDeficitQueue;
