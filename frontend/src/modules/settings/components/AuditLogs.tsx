// ENTERPRISE FIX: Phase 6 Final Polish + Full E2E Tests + Deployment Guide - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Clock, Shield, ShieldAlert, User, Filter, RefreshCcw, Download, Calendar } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import apiClient from '@api/client';
import { toast } from '@services/toastService';
import { formatDateTime } from '@services/dateFormat';

/**
 * Gate 3.1 - this type did not describe the payload, and the component then
 * rendered against fields the server never sends.
 *
 * The server returns `{ rows, total, limit, offset }`, and the fetch did
 * `Array.isArray(response.data) ? response.data : []` — always false, so the table
 * was permanently empty with no error. An auditor inspecting a security trail was
 * shown a blank screen, indistinguishable from "nothing happened".
 *
 * `details` was the field the UI read and `message` is the field the server sends
 * (the Prisma field `details` is mapped to the column `message`), so the details
 * column was always '-'. `status` is lower-cased by the server, and the comparison
 * was against 'SUCCESS', so every row was painted as a failure.
 */
interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUsername: string;
  actorRole: string;
  /** 'success' | 'failed' — lower case, as the server emits it. */
  status: 'success' | 'failed';
  targetUserId?: string | null;
  targetResource?: string | null;
  /** The human-readable line. The Prisma field is `details`; the column is `message`. */
  message: string;
  ipAddress?: string | null;
  metadata?: unknown;
}

interface AuditLogsPage {
  rows: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

interface AuditLogsProps {
}

/**
 * One definition of what an action badge looks like.
 *
 * The real ids are namespaced — ITEM_CREATE, REFERENCE_DATA_UPDATE,
 * LOGIN_FAILED, UNLOADING_RULE_UPDATE, SYSTEM_RESET_SUCCESS. Equality against
 * 'CREATE' matched none of them, so every badge fell through to neutral grey and a
 * destructive action was indistinguishable from a read.
 *
 * Order matters: the failure verbs are tested before the write verbs, because
 * LOGIN_FAILED also ends in 'FAILED' and SYSTEM_RESET_FAILURE in 'FAILURE' and
 * both must not be mistaken for an ordinary update.
 */
const actionTone = (action: string): string => {
  const id = String(action || '').toUpperCase();
  if (id.includes('DELETE') || id.includes('RESET_FAILURE') || id.includes('DENIED') || id.includes('INVALID')) {
    return 'bg-red-100 text-red-700';
  }
  if (id.includes('LOGIN_FAILED') || id.includes('LOCKED') || id.includes('REJECTED') || id.includes('EXPIRED')) {
    return 'bg-amber-100 text-amber-700';
  }
  if (id.endsWith('CREATE') || id.includes('CREATE')) return 'bg-emerald-100 text-emerald-700';
  if (id.includes('UPDATE') || id.includes('SET') || id.includes('CHANGE')) return 'bg-blue-100 text-blue-700';
  if (id.includes('ARCHIVE') || id.includes('RESTORE')) return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
};

/** The endpoint clamps to 1000; 50 keeps a page readable and the count cheap. */
const PAGE_SIZE = 50;

const AuditLogs: React.FC<AuditLogsProps> = ({ }) => {
  const { hasPermission } = usePermissions();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterEntity, setFilterEntity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<{ actions: string[]; entityTypes: string[] }>({
    actions: [],
    entityTypes: [],
  });
  const [dateRangeStart, setDateRangeStart] = useState<string>('');
  const [dateRangeEnd, setDateRangeEnd] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const logsRef = useRef<AuditLogEntry[]>([]);
  const lastLoadedAtRef = useRef(0);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const facetsLoadedRef = useRef(false);

  /**
   * Gate 3.9 — what the server is asked for, and why it lives in a ref.
   *
   * `loadAuditLogs` is memoised with an empty dependency list so that its identity
   * never changes: the effect at `:189` keys on the raw filter state and re-runs on
   * each change, and a callback that re-identified on every keystroke would make
   * the effect above it re-fire too, doubling the request.
   *
   * That memoisation is also what broke it. A function created once keeps the
   * `page` and filter values from the first render, so the effect re-requested the
   * same first page with no filters, forever. Advancing to page 3 fetched page 1;
   * picking `LOGIN_FAILED` fetched everything. The comment above the effect
   * described that symptom as the thing being prevented.
   *
   * A ref holds the query for the render that is on screen. It is written during
   * render rather than in an effect because an effect runs after the loader effect
   * would already have read it — the two are ordered by declaration, and a promise
   * is a poor thing to depend on ordering.
   */
  const buildAuditQuery = () => {
    const query: Record<string, unknown> = {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    };
    if (filterAction !== 'all') query.action = filterAction;
    if (filterEntity !== 'all') query.entityType = filterEntity;
    if (filterStatus !== 'all') query.status = filterStatus;
    if (dateRangeStart) query.from = new Date(dateRangeStart).toISOString();
    if (dateRangeEnd) query.to = new Date(`${dateRangeEnd}T23:59:59.999`).toISOString();
    if (searchTerm.trim()) query.search = searchTerm.trim();
    return query;
  };

  const currentQuery = buildAuditQuery();
  const currentQueryRef = useRef(currentQuery);
  currentQueryRef.current = currentQuery;

  const loadAuditLogs = useCallback(async (options?: { force?: boolean; background?: boolean }) => {
    const now = Date.now();
    if (!options?.force && now - lastLoadedAtRef.current < 30_000) {
      return;
    }

    if (loadInFlightRef.current) {
      return loadInFlightRef.current;
    }

    loadInFlightRef.current = (async () => {
      try {
        if (!options?.background) setLoading(true);

        // Gate 3.2 - the filters go to the server, not into a client-side
        // `.filter` over whatever page happened to be in memory. The endpoint
        // supports action, entityType, from, to, status, search, actorId,
        // entityId and offset; none of them were sent, so an auditor filtering
        // for last quarter's LOGIN_FAILED events was shown an incomplete answer
        // and would have concluded there were none.
        const response = await apiClient.get('/audit/logs', {
          params: currentQueryRef.current,
        });

        const payload = (response.data ?? {}) as Partial<AuditLogsPage>;
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        setLogs(rows);
        setTotal(Number(payload.total ?? rows.length));
        setError(null);

        // The dropdown options come from the database, not from this page. Built
        // from the page they could only ever offer actions that happen to appear
        // in the newest 50 rows, so the most useful filter — the rare one — was
        // the one you could not select.
        if (!facetsLoadedRef.current) {
          facetsLoadedRef.current = true;
          void apiClient
            .get('/audit/logs/facets')
            .then((facetResponse) => {
              setFacets({
                actions: Array.isArray(facetResponse.data?.actions) ? facetResponse.data.actions : [],
                entityTypes: Array.isArray(facetResponse.data?.entityTypes)
                  ? facetResponse.data.entityTypes
                  : [],
              });
            })
            .catch(() => {
              // A missing dropdown is a smaller problem than an empty table, and
              // the page above still works.
            });
        }
        lastLoadedAtRef.current = Date.now();
      } catch (error: any) {
        console.error('Failed to load audit logs:', error);
        setError('فشل تحميل سجلات التدقيق');
      } finally {
        setLoading(false);
        loadInFlightRef.current = null;
      }
    })();

    return loadInFlightRef.current;
  }, []);

  useEffect(() => {
    void loadAuditLogs({ force: true });
  }, [loadAuditLogs]);

  // Every filter change is a new query. Without this the server-side filtering is
  // applied to the first page only and the controls appear to do nothing until a
  // manual refresh.
  useEffect(() => {
    void loadAuditLogs({ force: true });
  }, [
    page,
    filterAction,
    filterEntity,
    filterStatus,
    dateRangeStart,
    dateRangeEnd,
    searchTerm,
  ]);

  // Changing a filter while on page 4 would ask the server for the fourth page of a
  // query that may have three, and show an empty table as the answer.
  const applyFilter = (setter: (value: string) => void) => (value: string) => {
    setPage(1);
    setter(value);
  };

  // Phase 6: Real-time Sync for Audit Logs
  useEffect(() => {
    logsRef.current = logs;
    
    // Listen for real-time updates
    const handleAuditUpdate = (event: CustomEvent) => {
      console.log('[AuditLogs] Real-time update received:', event.detail);
      void loadAuditLogs({ background: true });
    };

    window.addEventListener('audit-log-updated' as any, handleAuditUpdate);
    return () => window.removeEventListener('audit-log-updated' as any, handleAuditUpdate);
  }, [loadAuditLogs]);

  // Phase 6: Export to CSV
  /**
   * Export the whole filtered result, not the page in memory.
   *
   * This built the CSV from `filteredLogs` — the fifty rows the table happened to hold —
   * while `total` on screen came from the server. So an auditor filtered to a quarter of
   * `LOGIN_FAILED` events, saw "412 results", exported, and received one page, with a
   * success message: a compliance artefact that is silently incomplete and looks
   * complete. `GET /audit/logs/export` has accepted the same filters all along and was
   * called from nowhere.
   */
  const exportToCSV = async () => {
    try {
      setIsExporting(true);

      const response = await apiClient.get('/audit/logs/export', {
        params: {
          ...(filterAction !== 'all' ? { action: filterAction } : {}),
          // Gate 3.9 — the list query sends this and the export did not, so the row
          // count the "exported N of total" warning compares against was the count
          // of a different result set than the file holds. An auditor filtering by
          // entity exported every entity and was told the file was complete.
          ...(filterEntity !== 'all' ? { entityType: filterEntity } : {}),
          ...(filterStatus !== 'all' ? { status: filterStatus } : {}),
          ...(dateRangeStart ? { from: new Date(dateRangeStart).toISOString() } : {}),
          ...(dateRangeEnd
            ? { to: new Date(`${dateRangeEnd}T23:59:59.999`).toISOString() }
            : {}),
          ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
        },
        responseType: 'blob',
      });

      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(href);

      // Say what was exported. "تم" after a filtered export that returned one page was
      // the specific lie; the count is the cheapest way to stop it being tellable.
      // `response.data` is a Blob when `responseType: 'blob'`, so the row count is read
      // from the text rather than guessed at.
      const text = typeof (response.data as Blob)?.text === 'function'
        ? await (response.data as Blob).text()
        : String(response.data ?? '');
      const rowsExported = text.split('\n').filter((line) => line.trim().length > 0).length - 1;

      if (rowsExported <= 0) {
        toast.success('لم تُوجد سجلات مطابقة للتصدير.');
        return;
      }

      // The endpoint clamps to 1000 rows, so a wide filter exports a truncated file.
      // Saying "تم تصدير 1000 سجل" is true and still leaves an auditor holding an
      // incomplete compliance artefact with no sign it is incomplete — so the shortfall
      // is named, with the number that was left behind.
      if (total > rowsExported) {
        toast.warning(
          `تم تصدير ${rowsExported} سجل من ${total}. `
          + `التصدير محدود بـ1000 سجل لكل طلب — ضيّق المدى أو التاريخ لإكمال الباقي.`,
        );
        return;
      }

      toast.success(`تم تصدير ${rowsExported} سجل.`);
    } catch (error: any) {
      toast.error(error?.message || 'فشل التصدير');
    } finally {
      setIsExporting(false);
    }
  };

  if (!hasPermission('users.audit')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض سجلات التدقيق</div>
        <div>تحتاج إلى الصلاحية <code>users.audit</code>.</div>
      </div>
    );
  }

  // The rows are already what the query asked for. Filtering them again here was
  // harmless before because nothing was sent; now it would be a second, subtly
  // different definition of the same query, which is the arrangement that produced
  // the wrong answers in the first place.
  // The page's rows. Not filtered locally any more — the server applied every filter,
  // so this is exactly what the current page holds and nothing else.
  const pageRows = logs;

  // The filter options come from the server rather than from the rows on screen.
  // Deriving them from the page meant an action that exists in the database but not
  // in the newest 500 rows could not be selected at all — the option was simply
  // missing, so there was no way to search for it.
  const uniqueActions = facets.actions;
  const uniqueEntities = facets.entityTypes;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div>
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Shield size={20} className="text-blue-600" /> سجل التدقيق الأمني (Audit Trail)
          </h3>
          <p className="text-xs text-slate-500 mt-1">سجل غير قابل للتعديل لجميع العمليات الحساسة في النظام.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadAuditLogs({ force: true })} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">
            <RefreshCcw size={14} />
            تحديث
          </button>
          <button 
            onClick={exportToCSV} 
            // Keyed on `total`, not on the page. The export now goes to the server for the whole
            // filtered result, so an empty *page* (you are past the end, or a filter
            // narrowed things) is not a reason to refuse an export that has rows.
            disabled={isExporting || total === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            <Download size={14} />
            {isExporting ? 'جاري التصدير...' : 'تصدير CSV'}
          </button>
          <div className="text-xs font-mono bg-slate-200 px-2 py-1 rounded text-slate-600">
            BLOCKCHAIN_READY
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-2 flex-wrap items-center">
        <div className="flex items-center gap-2 text-sm">
          <Filter size={16} className="text-slate-500" />
          <span className="font-semibold">تصفية:</span>
        </div>
        <select
          value={filterAction}
          onChange={(e) => applyFilter(setFilterAction)(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
        >
          <option value="all">كل الإجراءات</option>
          {uniqueActions.map(action => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <select
          value={filterEntity}
          onChange={(e) => applyFilter(setFilterEntity)(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
        >
          <option value="all">كل الكيانات</option>
          {uniqueEntities.map(entity => (
            <option key={entity} value={entity}>{entity}</option>
          ))}
        </select>
        
        {/* Phase 6: Date Range Filter */}
        <div className="flex items-center gap-2 ml-2">
          <Calendar size={16} className="text-slate-500" />
          <input
            type="date"
            value={dateRangeStart}
            onChange={(e) => applyFilter(setDateRangeStart)(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            aria-label="من تاريخ"
          />
          <span className="text-slate-500">إلى</span>
          <input
            type="date"
            value={dateRangeEnd}
            onChange={(e) => applyFilter(setDateRangeEnd)(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            aria-label="إلى تاريخ"
          />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="sr-only">بحث في السجل</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => { setPage(1); setSearchTerm(e.target.value); }}
              placeholder="ابحث في السجل"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span>الحالة</span>
            <select
              value={filterStatus}
              onChange={(e) => applyFilter(setFilterStatus)(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="all">الكل</option>
              <option value="success">ناجحة</option>
              <option value="failed">فاشلة</option>
            </select>
          </label>

          {(dateRangeStart || dateRangeEnd) && (
            <button
              onClick={() => { setDateRangeStart(''); setDateRangeEnd(''); }}
              className="text-xs text-red-600 hover:underline"
            >
              مسح
            </button>
          )}
        </div>
        
        <span className="ml-auto text-sm text-slate-600">
          {/* The total is the server's, not the page length. It used to read
              "X of 50", where 50 was the page size — so the number an auditor took
              for the size of the trail was the size of the window they were
              looking through. */}
          عرض {pageRows.length} من {total} سجل
        </span>
      </div>

      {/* Gate 3.2 - the trail used to be a fixed 500-row window with no way past
          it, so anything older than the newest few hundred events was unreachable
          through the screen at all. */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          >
            السابق
          </button>
          <span className="text-xs text-slate-600">
            صفحة {page} من {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          >
            التالي
          </button>
        </div>
      )}

      <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
        <table className="w-full text-right text-xs">
          <thead className="bg-white text-slate-500 font-bold border-b border-slate-100 sticky top-0">
            <tr>
              <th className="p-4">التوقيت</th>
              <th className="p-4">المستخدم</th>
              <th className="p-4">الإجراء</th>
              <th className="p-4">الكيان</th>
              <th className="p-4">التفاصيل</th>
              <th className="p-4 text-center">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">جاري التحميل...</td></tr>
            ) : error ? (
              <tr><td colSpan={6} className="p-8 text-center text-red-600">{error}</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">لا توجد سجلات تطابق التصفية.</td></tr>
            ) : (
              [...pageRows].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 font-mono">
                  <td className="p-4 text-slate-600 dir-ltr">
                    <div className="flex items-center gap-2">
                      <Clock size={12} className="text-slate-400" />
                      {formatDateTime(log.timestamp)}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <User size={12} className="text-slate-400" />
                      <div>
                        <div className="font-bold">{log.actorUsername}</div>
                        <div className="text-slate-500 text-xs">{log.actorRole}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                      // The vocabulary is ITEM_CREATE, REFERENCE_DATA_UPDATE,
                      // LOGIN_FAILED, UNLOADING_RULE_UPDATE… Comparing for equality
                      // against 'CREATE' never matched, so every badge rendered grey
                      // and a destructive action looked like a read. Matching the
                      // suffix is what the ids actually look like — with the failure
                      // actions checked first, since LOGIN_FAILED also ends in nothing
                      // that reads as "create" but must not be painted as a write.
                      actionTone(log.action)
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="p-4 text-slate-600">{log.entityType}</td>
                  <td className="p-4 text-slate-600 max-w-xs truncate" title={log.message}>
                    {log.message || '-'}
                  </td>
                  <td className="p-4 text-center">
                    {/* The server lower-cases this. The comparison was against
                        'SUCCESS', so every row was painted as a failure — which
                        makes a successful action indistinguishable from a
                        suspicious one, the one distinction this table exists for. */}
                    <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                      log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLogs;
