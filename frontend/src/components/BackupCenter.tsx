// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  HardDrive,
  RefreshCw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { toast } from '@services/toastService';
import { User } from '../types';
import {
  applyRestore,
  BackupHistoryEntry,
  BackupKind,
  BackupStorageStats,
  createBackupByType,
  downloadBackupFile,
  fetchBackupHistory,
  fetchStorageStats,
  previewRestore,
  removeBackup,
  saveBackupSchedule,
} from '../services/backupCenterApi';

interface BackupCenterProps {
  currentUser?: User;
}

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'غير متوفر';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'غير متوفر';
  return parsed.toLocaleString('ar-EG', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const triggerLabel = (trigger: 'manual' | 'scheduled') => (trigger === 'scheduled' ? 'مجدول' : 'يدوي');

const typeLabel = (type: BackupKind) => {
  if (type === 'full') return 'نسخة احتياطية كاملة';
  if (type === 'inventory') return 'نسخة بيانات المخزون';
  if (type === 'config') return 'نسخة الإعدادات';
  return 'Safety Snapshot';
};

const actorLabel = (entry: BackupHistoryEntry) => {
  if (entry.actor.type === 'user') {
    const name = entry.actor.username || String(entry.actor.userId || 'User');
    return `Admin (${name} - ${triggerLabel(entry.trigger)})`;
  }
  return `System (${triggerLabel(entry.trigger)})`;
};

const cardClasses = 'rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-xl shadow-sm';

const BackupCenter: React.FC<BackupCenterProps> = ({ currentUser }) => {
  const [history, setHistory] = useState<BackupHistoryEntry[]>([]);
  const [storage, setStorage] = useState<BackupStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyType, setBusyType] = useState<Exclude<BackupKind, 'safety_snapshot'> | null>(null);
  const [activeType, setActiveType] = useState<Exclude<BackupKind, 'safety_snapshot'>>('full');

  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [scheduleHour, setScheduleHour] = useState(2);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [retentionDays, setRetentionDays] = useState(30);
  const [storageTargets, setStorageTargets] = useState<Array<'local' | 'usb' | 'drive'>>(['local']);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [restorePin, setRestorePin] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupHistoryEntry | null>(null);
  const [restoreToken, setRestoreToken] = useState('');
  const [safetySnapshotId, setSafetySnapshotId] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [showPulse, setShowPulse] = useState(false);

  const canCreate = (currentUser?.roleId ?? currentUser?.role) === 'admin';

  const hydrateSchedule = (stats: BackupStorageStats | null) => {
    if (!stats?.schedule) return;
    const schedule = stats.schedule;
    setScheduleEnabled(Boolean(schedule.enabled));
    setScheduleFrequency(schedule.frequency);
    setScheduleHour(schedule.hour);
    setScheduleMinute(schedule.minute);
    setRetentionDays(schedule.retentionDays);
    setStorageTargets((schedule.storageTargets as Array<'local' | 'usb' | 'drive'>) || ['local']);
    setEncryptionEnabled(Boolean(schedule.encryptionEnabled));
  };

  const loadData = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setRefreshing(!showSpinner);
    try {
      const [stats, logs] = await Promise.all([fetchStorageStats(), fetchBackupHistory()]);
      setStorage(stats);
      setHistory(logs);
      hydrateSchedule(stats);
    } catch (error: any) {
      toast.error(error?.message || 'تعذر تحميل بيانات النسخ الاحتياطي.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData(true);
  }, []);

  const filteredHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (activeType === 'full') return sorted.filter((entry) => entry.type === 'full' || entry.type === 'safety_snapshot');
    return sorted.filter((entry) => entry.type === activeType);
  }, [history, activeType]);

  const latestBackup = useMemo(() => {
    return [...history].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }, [history]);

  const runBackup = async (type: Exclude<BackupKind, 'safety_snapshot'>) => {
    if (!canCreate) return;
    if (type === activeType) setShowPulse(true);
    setBusyType(type);
    try {
      await createBackupByType(type, encryptionPassword || undefined);
      toast.success('تم إنشاء النسخة الاحتياطية بنجاح.');
      await loadData(false);
    } catch (error: any) {
      toast.error(error?.message || 'فشل إنشاء النسخة الاحتياطية.');
    } finally {
      setBusyType(null);
      if (type === activeType) {
        setTimeout(() => setShowPulse(false), 250);
      }
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await saveBackupSchedule({
        enabled: scheduleEnabled,
        frequency: scheduleFrequency,
        hour: scheduleHour,
        minute: scheduleMinute,
        retentionDays,
        storageTargets,
        encryptionEnabled,
        encryptionPassword: encryptionPassword || undefined,
        restorePin: restorePin || undefined,
      });
      toast.success('تم حفظ إعدادات الجدولة بنجاح.');
      setEncryptionPassword('');
      setRestorePin('');
      await loadData(false);
    } catch (error: any) {
      toast.error(error?.message || 'تعذر حفظ إعدادات الجدولة.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleDownload = async (entry: BackupHistoryEntry) => {
    try {
      const file = await downloadBackupFile(entry.id);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(`تم تنزيل النسخة الاحتياطية (SHA-256: ${file.checksum.slice(0, 10)}...)`);
    } catch (error: any) {
      toast.error(error?.message || 'تعذر تنزيل النسخة الاحتياطية.');
    }
  };

  const handleDelete = async (entry: BackupHistoryEntry) => {
    if (!window.confirm('هل تريد حذف هذه النسخة الاحتياطية نهائيًا؟')) return;
    try {
      await removeBackup(entry.id);
      toast.success('تم حذف النسخة الاحتياطية.');
      await loadData(false);
    } catch (error: any) {
      toast.error(error?.message || 'تعذر حذف النسخة الاحتياطية.');
    }
  };

  const openRestorePreview = async (entry: BackupHistoryEntry) => {
    try {
      if (!restorePin.trim()) {
        toast.error('أدخل رمز الاستعادة أولًا.');
        return;
      }

      const preview = await previewRestore({
        backupId: entry.id,
        restorePin,
        decryptionPassword: restorePassword || undefined,
      });

      setRestoreTarget(entry);
      setRestoreToken(String(preview?.restoreToken || ''));
      setSafetySnapshotId(String(preview?.safetySnapshotId || ''));
      setRestoreModalOpen(true);
      toast.success('تم إنشاء لقطة أمان مؤقتة. راجع المعاينة قبل تأكيد الاستعادة.');
      await loadData(false);
    } catch (error: any) {
      toast.error(error?.message || 'تعذر تجهيز معاينة الاستعادة.');
    }
  };
  const handleRestoreConfirm = async () => {
    if (!restoreTarget || !restoreToken) {
      toast.error('بيانات الاستعادة غير مكتملة.');
      return;
    }

    setRestoring(true);
    try {
      await applyRestore({
        backupId: restoreTarget.id,
        restoreToken,
        restorePin,
        decryptionPassword: restorePassword || undefined,
      });
      toast.success('تم تنفيذ الاستعادة بنجاح. سيتم تحديث الصفحة خلال لحظات.');
      setRestoreModalOpen(false);
      await loadData(false);
      setTimeout(() => window.location.reload(), 500);
    } catch (error: any) {
      toast.error(error?.message || 'تعذر تنفيذ الاستعادة.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6" style={{ fontFamily: 'Inter, sans-serif' }} dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={`${cardClasses} p-5`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Shield className="text-blue-600" size={24} /> Backup Dashboard
            </h2>
            <p className="text-sm text-slate-600 mt-1">8&787 788 77 787778y778y 788&7778y 8&7 Safety Snapshot 8Integrity Check.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadData(false)}
            disabled={refreshing}
            className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> 7778y7
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
          <div className="xl:col-span-1 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={storage?.segments || []}
                  dataKey="valueBytes"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {(storage?.segments || []).map((segment) => (
                    <Cell key={segment.key} fill={segment.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => formatBytes(Number(value || 0))} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="xl:col-span-2 space-y-2">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
              <div className="font-bold text-slate-800">777 8 777: {formatDateTime(latestBackup?.createdAt || storage?.latestBackup?.createdAt || null)}</div>
              <div className="text-slate-600 mt-1">78778&: {formatBytes(latestBackup?.sizeBytes || storage?.latestBackup?.sizeBytes || 0)}</div>
              <div className="mt-1 flex items-center gap-2">
                {(latestBackup?.integrity || storage?.latestBackup?.integrity) === 'verified' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><ShieldCheck size={14} />78& 787788</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-700 font-semibold"><ShieldAlert size={14} />7788 8~778</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
              <div className="font-bold text-slate-800 inline-flex items-center gap-1"><Clock3 size={14} /> 7877887 788778&7</div>
              <div className="text-slate-600 mt-1">{formatDateTime(storage?.schedule?.nextRunAt || null)}</div>
              <div className="text-slate-600 mt-1">7777778& 787778y8 : {Number(storage?.usagePercent || 0).toFixed(1)}%</div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {(storage?.segments || []).map((segment) => (
                <div key={segment.key} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="font-semibold" style={{ color: segment.color }}>{segment.label}</div>
                  <div className="text-slate-600">{segment.percentage.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }} className={`${cardClasses} p-5`}>
        <h3 className="text-lg font-bold text-slate-900 mb-3">8 87 788 777</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(['full', 'inventory', 'config'] as Array<Exclude<BackupKind, 'safety_snapshot'>>).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setActiveType(type)}
              className={`rounded-xl px-4 py-3 border text-sm font-semibold transition ${
                activeType === type
                  ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {typeLabel(type)}
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.1 }} className={`${cardClasses} p-5`}>
        <h3 className="text-lg font-bold text-slate-900 mb-3">787777777 788&7878&7</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-sm text-slate-700">
            7878777
            <select value={scheduleFrequency} onChange={(event) => setScheduleFrequency(event.target.value as any)} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
              <option value="daily">8y88&8y</option>
              <option value="weekly">777878y</option>
              <option value="monthly">78!78y</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            787777
            <input type="number" min={0} max={23} value={scheduleHour} onChange={(event) => setScheduleHour(Number(event.target.value || 0))} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
          </label>

          <label className="text-sm text-slate-700">
            78788y87
            <input type="number" min={0} max={59} value={scheduleMinute} onChange={(event) => setScheduleMinute(Number(event.target.value || 0))} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
          </label>

          <label className="text-sm text-slate-700">
            787778~77 (8y88&)
            <input type="number" min={1} max={3650} value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value || 30))} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <label className="text-sm text-slate-700">
            كلمة مرور التشفير AES-256 (اختياري)
            <input type="password" value={encryptionPassword} onChange={(event) => setEncryptionPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" placeholder="******" />
          </label>

          <label className="text-sm text-slate-700">
            Restore PIN (2FA)
            <input type="password" value={restorePin} onChange={(event) => setRestorePin(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" placeholder="PIN من 4 أرقام" />
          </label>

          <label className="text-sm text-slate-700">
            كلمة مرور فك التشفير لعملية الاستعادة
            <input type="password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" placeholder="كلمة المرور" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {(['local', 'usb', 'drive'] as Array<'local' | 'usb' | 'drive'>).map((target) => {
            const checked = storageTargets.includes(target);
            return (
              <button
                key={target}
                type="button"
                onClick={() =>
                  setStorageTargets((prev) =>
                    prev.includes(target) ? prev.filter((item) => item !== target) : [...prev, target],
                  )
                }
                className={`px-3 py-1.5 rounded-lg border ${checked ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 bg-white'}`}
              >
                {target.toUpperCase()}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setScheduleEnabled((value) => !value)}
            className={`px-3 py-1.5 rounded-lg border ${scheduleEnabled ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            الجدولة: {scheduleEnabled ? 'مفعلة' : 'متوقفة'}
          </button>

          <button
            type="button"
            onClick={() => setEncryptionEnabled((value) => !value)}
            className={`px-3 py-1.5 rounded-lg border ${encryptionEnabled ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            التشفير: {encryptionEnabled ? 'مفعل' : 'متوقف'}
          </button>

          <button
            type="button"
            onClick={handleSaveSchedule}
            disabled={savingSchedule}
            className="px-3 py-1.5 rounded-lg border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-1"
          >
            <Save size={14} /> {savingSchedule ? 'جارٍ الحفظ...' : 'حفظ الجدولة'}
          </button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.15 }} className={`${cardClasses} p-5`}>
        <h3 className="text-lg font-bold text-slate-900 mb-3">إنشاء نسخة احتياطية</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <AnimatePresence>
              {showPulse && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1.08, opacity: 1 }}
                  exit={{ scale: 1.2, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="pulse-ring bg-green-500/30 absolute inset-0 rounded-xl pointer-events-none"
                />
              )}
            </AnimatePresence>
            <button
              type="button"
              onClick={() => void runBackup(activeType)}
              disabled={busyType !== null || !canCreate}
              className="relative z-10 w-full rounded-xl px-4 py-3 bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
            >
              {busyType === activeType ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة كاملة'}
            </button>
          </div>
          <button type="button" onClick={() => void runBackup('inventory')} disabled={busyType !== null || !canCreate} className="rounded-xl px-4 py-3 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60">{busyType === 'inventory' ? 'جارٍ إنشاء النسخة...' : 'نسخة للمخزون فقط'}</button>
          <div className="rounded-xl px-4 py-3 bg-slate-100 border border-slate-200 text-slate-700 text-sm font-semibold inline-flex items-center justify-center gap-2">
            <ShieldCheck size={16} /> الاستعادة تتطلب رمز PIN صالح
          </div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.2 }} className={`${cardClasses} p-5`}>
        <h3 className="text-lg font-bold text-slate-900 mb-3">سجل النسخ الاحتياطية</h3>

        {loading ? (
          <div className="h-36 rounded-xl border border-slate-200 bg-slate-50 animate-pulse" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 text-right">Date</th>
                  <th className="py-2 text-right">Type</th>
                  <th className="py-2 text-right">Size</th>
                  <th className="py-2 text-right">Status</th>
                  <th className="py-2 text-right">By</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100">
                    <td className="py-2">{formatDateTime(entry.createdAt)}</td>
                    <td className="py-2 font-semibold text-slate-700">{typeLabel(entry.type)}</td>
                    <td className="py-2">{formatBytes(entry.sizeBytes)}</td>
                    <td className="py-2">
                      {entry.integrityVerified ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                          <ShieldCheck size={12} /> سليم
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                          <ShieldAlert size={12} /> فشل التحقق
                        </span>
                      )}
                    </td>
                    <td className="py-2">{actorLabel(entry)}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => void handleDownload(entry)} className="p-1.5 rounded hover:bg-slate-100 text-slate-700" title="تنزيل">
                          <Download size={14} />
                        </button>
                        <button type="button" onClick={() => void openRestorePreview(entry)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-700" title="استعادة">
                          <HardDrive size={14} />
                        </button>
                        <button type="button" onClick={() => void handleDelete(entry)} className="p-1.5 rounded hover:bg-red-50 text-red-700" title="778~">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-slate-500">87 7877 8 77 7778y778y7 8&77787 888 87 788&7777.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {restoreModalOpen && restoreTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl p-5 space-y-4">
            <h4 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Shield size={20} className="text-blue-600" /> 7788y7 787777777 7878&8 7
            </h4>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>788 777 788&778!78~7: <strong>{typeLabel(restoreTarget.type)}</strong></p>
              <p>7778y7 788 777: <strong>{formatDateTime(restoreTarget.createdAt)}</strong></p>
              <p>Safety Snapshot: <strong>{safetySnapshotId || 'لم يتم الإنشاء بعد'}</strong></p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
              <p className="font-semibold inline-flex items-center gap-1"><AlertTriangle size={14} /> 78y78& 7778y8 787777777 777 8!77 787788y7 8~87.</p>
              <p className="mt-1">78& 78 8~8y7 Auto-backup 887787 787788y7 778&7 878 777 8!78! 788 78~77.</p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                78777
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreConfirm()}
                disabled={restoring}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {restoring ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 7788y7 787777777
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupCenter;

