// ENTERPRISE FIX: Phase 6 Final Polish + Full E2E Tests + Deployment Guide - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useState, useRef } from 'react';
import { Clock, Shield, ShieldAlert, User, Filter, RefreshCcw, Download, Calendar } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import apiClient from '@api/client';
import { toast } from '@services/toastService';

interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUsername: string;
  actorRole: string;
  status: string;
  details?: string;
}

interface AuditLogsProps {
  forceAccess?: boolean;
}

const AuditLogs: React.FC<AuditLogsProps> = ({ forceAccess = false }) => {
  const { hasPermission } = usePermissions();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterEntity, setFilterEntity] = useState<string>('all');
  const [dateRangeStart, setDateRangeStart] = useState<string>('');
  const [dateRangeEnd, setDateRangeEnd] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const logsRef = useRef<AuditLogEntry[]>([]);

  useEffect(() => {
    loadAuditLogs();
  }, []);

  // Phase 6: Real-time Sync for Audit Logs
  useEffect(() => {
    logsRef.current = logs;
    
    // Listen for real-time updates
    const handleAuditUpdate = (event: CustomEvent) => {
      console.log('[AuditLogs] Real-time update received:', event.detail);
      loadAuditLogs(); // Reload logs on real-time update
    };

    window.addEventListener('audit-log-updated' as any, handleAuditUpdate);
    return () => window.removeEventListener('audit-log-updated' as any, handleAuditUpdate);
  }, [logs]);

  const loadAuditLogs = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/audit/logs', {
        params: { limit: 500 }
      });
      setLogs(response.data || []);
      setError(null);
    } catch (error: any) {
      console.error('Failed to load audit logs:', error);
      setError('فشل تحميل سجلات التدقيق');
    } finally {
      setLoading(false);
    }
  };

  // Phase 6: Export to CSV
  const exportToCSV = async () => {
    try {
      setIsExporting(true);
      const headers = ['التوقيت', 'المستخدم', 'الإجراء', 'الكيان', 'المعرف', 'الحالة', 'التفاصيل'];
      const rows = filteredLogs.map(log => [
        new Date(log.timestamp).toLocaleString('ar-EG'),
        log.actorUsername,
        log.action,
        log.entityType,
        log.entityId,
        log.status,
        log.details ? JSON.parse(log.details).message || log.details : '-',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success('تم تصدير CSV بنجاح');
    } catch (error: any) {
      toast.error(error?.message || 'فشل التصدير');
    } finally {
      setIsExporting(false);
    }
  };

  if (!forceAccess && !hasPermission('settings.view.audit')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض سجلات التدقيق</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.audit</code>.</div>
      </div>
    );
  }

  const filteredLogs = logs.filter(log => {
    if (filterAction !== 'all' && log.action !== filterAction) return false;
    if (filterEntity !== 'all' && log.entityType !== filterEntity) return false;
    
    // Phase 6: Date Range Filter
    if (dateRangeStart) {
      const logDate = new Date(log.timestamp).getTime();
      const startDate = new Date(dateRangeStart).getTime();
      if (logDate < startDate) return false;
    }
    if (dateRangeEnd) {
      const logDate = new Date(log.timestamp).getTime();
      const endDate = new Date(dateRangeEnd).setHours(23, 59, 59, 999);
      if (logDate > endDate) return false;
    }
    
    return true;
  });

  const uniqueActions = Array.from(new Set(logs.map(l => l.action)));
  const uniqueEntities = Array.from(new Set(logs.map(l => l.entityType)));

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
          <button onClick={loadAuditLogs} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">
            <RefreshCcw size={14} />
            تحديث
          </button>
          <button 
            onClick={exportToCSV} 
            disabled={isExporting || filteredLogs.length === 0}
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
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm"
        >
          <option value="all">كل الإجراءات</option>
          {uniqueActions.map(action => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <select
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
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
            onChange={(e) => setDateRangeStart(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            placeholder="من"
          />
          <span className="text-slate-500">إلى</span>
          <input
            type="date"
            value={dateRangeEnd}
            onChange={(e) => setDateRangeEnd(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            placeholder="إلى"
          />
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
          عرض {filteredLogs.length} من {logs.length} سجل
        </span>
      </div>

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
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">لا توجد سجلات تطابق التصفية.</td></tr>
            ) : (
              [...filteredLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 font-mono">
                  <td className="p-4 text-slate-600 dir-ltr">
                    <div className="flex items-center gap-2">
                      <Clock size={12} className="text-slate-400" />
                      {new Date(log.timestamp).toLocaleString('ar-EG')}
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
                      log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-700' :
                      log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                      log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                      log.action === 'ARCHIVE' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="p-4 text-slate-600">{log.entityType}</td>
                  <td className="p-4 text-slate-600 max-w-xs truncate" title={log.details}>
                    {log.details ? JSON.parse(log.details).message || log.details : '-'}
                  </td>
                  <td className="p-4 text-center">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
                      log.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
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
