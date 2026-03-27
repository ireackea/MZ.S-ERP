// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import { Clock, Shield, ShieldAlert, User } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import type { AuditLog } from '../../../types';

interface AuditLogsProps {
  logs: AuditLog[];
  forceAccess?: boolean;
}

const AuditLogs: React.FC<AuditLogsProps> = ({ logs, forceAccess = false }) => {
  const { hasPermission } = usePermissions();

  if (!forceAccess && !hasPermission('settings.view.audit')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض سجلات التدقيق</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.audit</code>.</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div>
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Shield size={20} className="text-blue-600" /> سجل التدقيق الأمني (Audit Trail)
          </h3>
          <p className="text-xs text-slate-500 mt-1">سجل غير قابل للتعديل لجميع العمليات الحساسة في النظام.</p>
        </div>
        <div className="text-xs font-mono bg-slate-200 px-2 py-1 rounded text-slate-600">
          BLOCKCHAIN_READY
        </div>
      </div>
      <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
        <table className="w-full text-right text-xs">
          <thead className="bg-white text-slate-500 font-bold border-b border-slate-100 sticky top-0">
            <tr>
              <th className="p-4">التوقيت</th>
              <th className="p-4">المستخدم</th>
              <th className="p-4">الإجراء</th>
              <th className="p-4">الكيان</th>
              <th className="p-4">التفاصيل</th>
              <th className="p-4 text-center">Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {logs.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">لا توجد سجلات بعد.</td></tr>
            ) : (
              [...logs].sort((a, b) => b.timestamp - a.timestamp).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 font-mono">
                  <td className="p-4 text-slate-600 dir-ltr">
                    <div className="flex items-center gap-2">
                      <Clock size={12} />
                      {new Date(log.timestamp).toLocaleString('en-GB')}
                    </div>
                  </td>
                  <td className="p-4 font-bold text-slate-800">
                    <div className="flex items-center gap-2">
                      <User size={12} />
                      {log.userName}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                      log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                      log.action === 'CREATE' ? 'bg-green-100 text-green-700' :
                      log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500">{log.entity}</td>
                  <td className="p-4 max-w-xs truncate text-slate-600" title={log.details}>{log.details}</td>
                  <td className="p-4 text-center">
                    <span className="text-[10px] text-slate-300 select-all" title={log.ipHash}>{log.ipHash?.substring(0, 8)}...</span>
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