// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Item, Transaction } from '../types';
import { AlertTriangle, Download, Eye, EyeOff, FileDown, Filter, Save, Upload } from 'lucide-react';
import {
  computeMonthlyAuditRows,
  getMonthBounds,
  getOrCreateMonthlySession,
  loadMonthlySession,
  isItemConflicted,
  saveMonthlySession,
  upsertItemCount,
} from '../services/monthlyStocktakingService';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../store/useInventoryStore';
import { exportRowsToExcel, readFirstWorksheetRows } from '../utils/excelWorkbook';
import StocktakingAuditPane from './stocktaking/StocktakingAuditPane';
import { getOpeningBalances } from '../services/openingBalanceService';
import { formatNumber, getAuditEntryStatus } from './stocktaking/shared';

interface StocktakingProps {
  items?: Item[];
  transactions?: Transaction[];
  currentUserName?: string;
  companyName?: string;
  companyLogoUrl?: string;
}

type WorkPane = 'operations' | 'audit';
type QuickFilter = 'all' | 'conflicts';

const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const Stocktaking: React.FC<StocktakingProps> = ({
  items: itemsProp,
  transactions: transactionsProp,
  currentUserName,
  companyLogoUrl,
}) => {
  const storeItems = useInventoryStore((state) => state.items);
  const storeTransactions = useInventoryStore((state) => state.transactions);
  const storeSystemSettings = useInventoryStore((state) => state.systemSettings);

  const items = itemsProp && itemsProp.length > 0 ? itemsProp : storeItems;
  const transactions = transactionsProp && transactionsProp.length > 0 ? transactionsProp : storeTransactions;
  const resolvedCompanyLogoUrl = companyLogoUrl || storeSystemSettings.logoUrl || '';

  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [pane, setPane] = useState<WorkPane>('operations');
  const [blindMode, setBlindMode] = useState(true);
  const [zoneFilter, setZoneFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [statusMessage, setStatusMessage] = useState('');
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [draftUsers, setDraftUsers] = useState<Record<string, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [session, setSession] = useState(() => getOrCreateMonthlySession(monthKey));
  const [openingBalances, setOpeningBalances] = useState<Record<string, number>>({});

  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void loadMonthlySession(monthKey)
      .then((loaded) => {
        if (!active) return;
        setSession(loaded);
      })
      .catch((error) => console.error('Failed to load stocktaking session', error));
    return () => {
      active = false;
    };
  }, [monthKey]);

  useEffect(() => {
    const year = Number(monthKey.split('-')[0]);
    void getOpeningBalances(year)
      .then((payload: any) => {
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        setOpeningBalances(Object.fromEntries(rows.map((row: any) => [row.itemPublicId || String(row.itemId), Number(row.quantity || 0)])));
      })
      .catch((error) => console.error('Failed to load opening balances', error));
  }, [monthKey]);

  const refreshSession = () => {
    void loadMonthlySession(monthKey)
      .then(setSession)
      .catch((error) => console.error('Failed to refresh stocktaking session', error));
  };

  const { start, end } = useMemo(() => getMonthBounds(monthKey), [monthKey]);

  const zones = useMemo(() => {
    const values = Array.from(new Set(items.map((item) => item.zone?.trim() || 'بدون منطقة'))).sort();
    return ['all', ...values];
  }, [items]);

  const zoneItems = useMemo(() => {
    if (zoneFilter === 'all') return items;
    return items.filter((item) => (item.zone?.trim() || 'بدون منطقة') === zoneFilter);
  }, [items, zoneFilter]);

  const auditRows = useMemo(() => {
    const all = computeMonthlyAuditRows({ monthKey, items, transactions, openingBalances });
    if (zoneFilter === 'all') return all;
    const zoneItemIds = new Set(zoneItems.map((item) => item.id));
    return all.filter((row) => zoneItemIds.has(row.itemId));
  }, [monthKey, items, transactions, openingBalances, zoneFilter, zoneItems]);

  const operationsRows = useMemo(() => {
    const byItemId = new Map(auditRows.map((row) => [row.itemId, row]));
    return zoneItems
      .map((item) => {
        const itemRecord = session.itemRecords[item.id];
        const conflict = isItemConflicted(itemRecord);
        const row = byItemId.get(item.id);
        return { item, itemRecord, conflict, row };
      })
      .filter((entry) => (quickFilter === 'conflicts' ? entry.conflict : true));
  }, [auditRows, quickFilter, session.itemRecords, zoneItems]);

  const totalItemsForProgress = zoneItems.length;
  const enteredItemsForProgress = zoneItems.filter((item) => session.itemRecords[item.id]?.actualCount !== undefined).length;
  const progress = totalItemsForProgress === 0 ? 0 : Math.round((enteredItemsForProgress / totalItemsForProgress) * 100);
  const conflictCount = useMemo(
    () => zoneItems.filter((item) => isItemConflicted(session.itemRecords[item.id])).length,
    [session.itemRecords, zoneItems],
  );
  const isClosed = session.closed;

  const getDraftCount = (itemId: string) => {
    if (draftCounts[itemId] !== undefined) return draftCounts[itemId];
    const saved = session.itemRecords[itemId]?.actualCount;
    return saved === undefined ? '' : String(saved);
  };

  const getDraftUser = (itemId: string) => {
    if (draftUsers[itemId]) return draftUsers[itemId];
    return currentUserName || 'النظام';
  };

  const getDraftNote = (itemId: string) => {
    if (draftNotes[itemId] !== undefined) return draftNotes[itemId];
    return session.itemRecords[itemId]?.notes || '';
  };

  const saveSingleItem = async (itemId: string, resolveConflict = false) => {
    if (isClosed) return;

    const rawCount = getDraftCount(itemId);
    const parsed = Number(String(rawCount).replace(/,/g, '').trim());
    if (!Number.isFinite(parsed)) {
      setStatusMessage('القيمة المدخلة في حقل الجرد غير صالحة.');
      return;
    }

    const updated = await upsertItemCount({
      monthKey,
      itemId,
      userName: getDraftUser(itemId),
      value: parsed,
      notes: getDraftNote(itemId),
      resolveConflict,
    });

    if (resolveConflict && updated.itemRecords[itemId]) {
      updated.itemRecords[itemId].entries = [{ userName: getDraftUser(itemId), value: parsed, at: Date.now() }];
      saveMonthlySession(updated);
    }

    refreshSession();
    setStatusMessage('تم حفظ جرد هذا الصنف بنجاح.');
  };

  const saveAllVisible = async () => {
    for (const { item } of operationsRows) {
      await saveSingleItem(item.id);
    }
  };

  const exportTemplate = async () => {
    const rows = zoneItems.map((item) => ({
      item_code: item.code || '',
      item_name: item.name,
      zone: item.zone || 'بدون منطقة',
      actual_count: '',
      user_name: currentUserName || 'النظام',
      notes: '',
    }));

    await exportRowsToExcel({
      rows,
      sheetName: 'Template',
      fileName: `Stocktaking_Template_${monthKey}.xlsx`,
    });
  };

  const exportCurrentEntries = async () => {
    const rows = operationsRows.map(({ item, itemRecord, conflict }) => ({
      status: getAuditEntryStatus(itemRecord?.actualCount, conflict).label,
      item_code: item.code || '',
      item_name: item.name,
      zone: item.zone || 'بدون منطقة',
      actual_count: itemRecord?.actualCount ?? '',
      conflict: getAuditEntryStatus(itemRecord?.actualCount, conflict).label,
      entered_by: itemRecord?.entries.map((entry) => `${entry.userName}:${entry.value}`).join(' | ') || '',
      notes: itemRecord?.notes || '',
    }));

    await exportRowsToExcel({
      rows,
      sheetName: 'Entries',
      fileName: `Stocktaking_Entries_${monthKey}.xlsx`,
    });
  };

  const handleImportFile = async (file: File | null) => {
    if (!file || isClosed) return;

    const rows = await readFirstWorksheetRows(file);
    let importedCount = 0;

    for (const row of rows) {
      const code = String(row.item_code || row['item code'] || '').trim();
      const name = String(row.item_name || row['item name'] || '').trim();
      const countRaw = String(row.actual_count || row['actual count'] || '').trim();
      const userName = String(row.user_name || row['user name'] || currentUserName || 'النظام').trim();
      const notes = String(row.notes || '').trim();

      const parsedCount = Number(countRaw.replace(/,/g, ''));
      if (!Number.isFinite(parsedCount)) return;

      const item = items.find((candidate) => {
        if (code && candidate.code === code) return true;
        if (name && candidate.name === name) return true;
        return false;
      });

      if (!item) return;

      await upsertItemCount({ monthKey, itemId: item.id, userName, value: parsedCount, notes });
      importedCount += 1;
    }

    refreshSession();
    setStatusMessage(`تم استيراد ${importedCount} صنف بنجاح.`);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">تقرير الجرد الشهري واعتماد الجرد الدفتري</h2>
            <p className="text-sm text-slate-500">ملاحظة حول الألوان: الافتتاحي/الوارد/المرتجع + المنصرف/الهالك</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              title="شهر الجرد"
              className="px-3 py-2 border border-slate-300 rounded-lg"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
            />

            <select
              className="px-3 py-2 border border-slate-300 rounded-lg"
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
              title="المنطقة"
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>{zone === 'all' ? 'كل المناطق' : zone}</option>
              ))}
            </select>

            <button
              className={`px-3 py-2 rounded-lg border font-bold flex items-center gap-2 ${blindMode ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-slate-300 text-slate-700'}`}
              onClick={() => setBlindMode((prev) => !prev)}
              title="تفعيل/إلغاء وضع الجرد الأعمى"
            >
              {blindMode ? <EyeOff size={16} /> : <Eye size={16} />} {blindMode ? 'وضع الجرد الأعمى: مفعل' : 'وضع الجرد الأعمى: معطل'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className={`px-3 py-2 rounded-lg border font-bold ${pane === 'operations' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setPane('operations')}>
            لوحة العمليات / الإدخال
          </button>
          <button className={`px-3 py-2 rounded-lg border font-bold ${pane === 'audit' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setPane('audit')}>
            المراجعة / الطباعة
          </button>
        </div>
      </div>

      {pane === 'operations' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
            <div>
              <div className="text-sm text-slate-700 font-bold">تم الجرد: {enteredItemsForProgress} / {totalItemsForProgress}</div>
              <progress className="w-72 max-w-full mt-2 h-2.5" value={progress} max={100} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button className={`px-3 py-2 rounded-lg border text-sm font-bold ${quickFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setQuickFilter('all')}>
                <Filter size={14} className="inline ml-1" /> كل الأصناف
              </button>
              <button className={`px-3 py-2 rounded-lg border text-sm font-bold ${quickFilter === 'conflicts' ? 'bg-red-700 text-white border-red-700' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setQuickFilter('conflicts')}>
                <AlertTriangle size={14} className="inline ml-1" /> الأصناف المتضاربة فقط ({conflictCount})
              </button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={exportTemplate} disabled={isClosed}><Download size={14} className="inline ml-1" /> قالب الاستيراد</button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={exportCurrentEntries}><FileDown size={14} className="inline ml-1" /> تنزيل المدخلات</button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={() => importInputRef.current?.click()} disabled={isClosed}><Upload size={14} className="inline ml-1" /> استيراد</button>
              <input ref={importInputRef} type="file" title="استيراد ملف جرد" accept=".xlsx,.csv" className="hidden" onChange={(event) => { void handleImportFile(event.target.files?.[0] || null); event.currentTarget.value = ''; }} />
              <button className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold" onClick={saveAllVisible} disabled={isClosed}><Save size={14} className="inline ml-1" /> حفظ الكل</button>
            </div>
          </div>

          {isClosed && (
            <div className="m-4 p-3 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-sm font-bold">
              تم إغلاق هذا الجرد (Read-Only). لا يمكن تعديل بيانات الجرد.
            </div>
          )}

          <div className="overflow-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-white border-b border-slate-200">
                <tr>
                  <th className="p-3 text-right">اسم الصنف</th>
                  <th className="p-3 text-right">المنطقة</th>
                  <th className="p-3 text-right">اسم المستخدم الذي قام بالجرد</th>
                  <th className="p-3 text-right">العدد الفعلي</th>
                  {!blindMode && <th className="p-3 text-right">الرصيد الدفتري</th>}
                  {!blindMode && <th className="p-3 text-right">الفارق</th>}
                  <th className="p-3 text-right">الملاحظات</th>
                  <th className="p-3 text-right">الحالة</th>
                  <th className="p-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {operationsRows.map(({ item, itemRecord, conflict, row }) => {
                  const difference = row?.difference;
                  const entryStatus = getAuditEntryStatus(itemRecord?.actualCount, conflict);

                  return (
                    <tr key={item.id} className={`border-b border-slate-100 ${conflict ? 'bg-red-50' : ''}`}>
                      <td className="p-3 font-bold text-slate-800">{item.name}</td>
                      <td className="p-3 text-slate-600">{item.zone || 'بدون منطقة'}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          title="اسم المستخدم الذي قام بالجرد"
                          value={getDraftUser(item.id)}
                          onChange={(event) => setDraftUsers((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          className="w-36 p-2 border border-slate-300 rounded-lg"
                          disabled={isClosed}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          title="العدد الفعلي"
                          value={getDraftCount(item.id)}
                          onChange={(event) => setDraftCounts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          className="w-36 p-2 border border-slate-300 rounded-lg"
                          placeholder={itemRecord?.actualCount !== undefined ? String(itemRecord.actualCount) : '0.000'}
                          disabled={isClosed}
                        />
                      </td>
                      {!blindMode && <td className="p-3 font-medium text-slate-700">{formatNumber(row?.theoreticalBalance)}</td>}
                      {!blindMode && (
                        <td className={`p-3 font-bold ${difference === undefined ? 'text-slate-400' : difference > 0 ? 'text-red-700' : difference < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                          {formatNumber(difference)}
                        </td>
                      )}
                      <td className="p-3">
                        <input
                          type="text"
                          title="ملاحظات الصنف"
                          value={getDraftNote(item.id)}
                          onChange={(event) => setDraftNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          className="w-52 p-2 border border-slate-300 rounded-lg"
                          disabled={isClosed}
                        />
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${entryStatus.className}`}>{entryStatus.label}</span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" onClick={() => saveSingleItem(item.id, false)} disabled={isClosed}>حفظ</button>
                          {conflict && (
                            <button className="px-2 py-1.5 rounded border border-red-300 text-red-700 text-xs font-bold" onClick={() => saveSingleItem(item.id, true)} disabled={isClosed}>حل التعارض</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {operationsRows.length === 0 && (
                  <tr>
                    <td colSpan={blindMode ? 7 : 9} className="p-6 text-center text-slate-500">لا توجد أصناف مطابقة للمرشحات الحالية.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pane === 'audit' && (
        <StocktakingAuditPane
          monthKey={monthKey}
          start={start}
          end={end}
          items={items}
          auditRows={auditRows}
          session={session}
          currentUserName={currentUserName}
          companyLogoUrl={resolvedCompanyLogoUrl}
          conflictCount={conflictCount}
          isClosed={isClosed}
           onSessionChanged={refreshSession}
          onStatusMessage={setStatusMessage}
        />
      )}

      {statusMessage && (
        <div className="p-3 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm">
          {statusMessage}
        </div>
      )}
    </div>
  );
};

export default Stocktaking;