// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
import React, { useEffect, useMemo, useState } from 'react';
import { Shield, RefreshCw, Clock, Smartphone, Filter } from 'lucide-react';
import apiClient from '@api/client';

interface AuditLogViewerProps {
  fallbackLogs?: Array<{
    id: string;
    userId?: string;
    userName?: string;
    action: string;
    details: string;
    timestamp: number;
  }>;
}

type AuditLogRow = {
  id: string;
  timestamp: string;
  action: string;
  actorId: string;
  actorUsername: string;
  actorRole: string;
  status: 'success' | 'failed';
  message: string;
  targetUserId?: string;
};

type ActiveSessionRow = {
  id: string;
  userId: string;
  username: string;
  role: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  isRevoked: boolean;
};

const AuditLogViewer: React.FC<AuditLogViewerProps> = ({ fallbackLogs = [] }) => {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [actionQuery, setActionQuery] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [logsRes, sessionsRes] = await Promise.all([
        apiClient.get('/audit/logs', { params: { limit: 500 } }),
        apiClient.get('/audit/sessions'),
      ]);

      setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
      setSessions(Array.isArray(sessionsRes.data) ? sessionsRes.data : []);
    } catch {
      const localMapped: AuditLogRow[] = fallbackLogs.map((entry) => ({
        id: entry.id,
        timestamp: new Date(entry.timestamp).toISOString(),
        action: entry.action,
        actorId: entry.userId || 'local-user',
        actorUsername: entry.userName || 'Local User',
        actorRole: 'local',
        status: 'success',
        message: entry.details,
        targetUserId: entry.userId,
      }));
      setLogs(localMapped);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs
      .filter((entry) => (statusFilter === 'all' ? true : entry.status === statusFilter))
      .filter((entry) => (actionQuery.trim() ? entry.action.toLowerCase().includes(actionQuery.trim().toLowerCase()) : true));
  }, [logs, statusFilter, actionQuery]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-800 font-bold">
          <Shield size={18} className="text-emerald-600" />
          سجل التدقيق الأمني المتقدم
        </div>
        <button
          onClick={() => void loadData()}
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-2"
        >
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
        <label className="text-sm text-slate-700 flex items-center gap-2">
          <Filter size={14} />
          الحالة
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'success' | 'failed')}
            className="ml-auto rounded border border-slate-300 px-2 py-1"
          >
            <option value="all">الكل</option>
            <option value="success">نجاح</option>
            <option value="failed">فشل</option>
          </select>
        </label>
        <label className="text-sm text-slate-700 md:col-span-2 flex items-center gap-2">
          <Filter size={14} />
          بحث بالإجراء
          <input
            value={actionQuery}
            onChange={(event) => setActionQuery(event.target.value)}
            className="ml-auto w-full md:w-72 rounded border border-slate-300 px-2 py-1"
            placeholder="مثال: LOGIN_SUCCESS"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-slate-200 font-bold text-slate-700">Audit Events</div>
        <div className="max-h-[380px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="p-3 text-right">الوقت</th>
                <th className="p-3 text-right">المستخدم</th>
                <th className="p-3 text-right">الإجراء</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500">جاري التحميل...</td></tr>
              ) : filteredLogs.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-slate-400">لا توجد سجلات</td></tr>
              ) : (
                filteredLogs.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3 text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString('ar-EG')}</td>
                    <td className="p-3 text-slate-700">{entry.actorUsername}</td>
                    <td className="p-3"><span className="font-mono text-xs">{entry.action}</span></td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${entry.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {entry.status === 'success' ? 'نجاح' : 'فشل'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{entry.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-slate-200 font-bold text-slate-700 flex items-center gap-2">
          <Smartphone size={16} className="text-blue-600" />
          الجلسات النشطة
        </div>
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="p-3 text-right">المستخدم</th>
                <th className="p-3 text-right">البصمة</th>
                <th className="p-3 text-right">آخر نشاط</th>
                <th className="p-3 text-right">ينتهي</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-slate-400">لا توجد جلسات نشطة</td></tr>
              ) : (
                sessions.map((session) => (
                  <tr key={session.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3 text-slate-700">{session.username}</td>
                    <td className="p-3 font-mono text-xs text-slate-600">{session.deviceFingerprint.slice(0, 14)}...</td>
                    <td className="p-3 text-xs text-slate-500 flex items-center gap-1"><Clock size={12} />{new Date(session.lastActivityAt).toLocaleString('ar-EG')}</td>
                    <td className="p-3 text-xs text-slate-500">{new Date(session.expiresAt).toLocaleString('ar-EG')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AuditLogViewer;
