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
import { toast } from '@services/toastService';
import { User } from '../types';
import { usePermissions } from '../hooks/usePermissions';
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

const frequencyLabel = (frequency: 'daily' | 'weekly' | 'monthly') => {
  if (frequency === 'weekly') return 'أسبوعي';
  if (frequency === 'monthly') return 'شهري';
  return 'يومي';
};

const storageTargetLabel: Record<'local' | 'usb' | 'drive', string> = {
  local: 'تخزين محلي',
  usb: 'وحدة USB',
  drive: 'مشاركة شبكة',
};

const segmentTextClass: Record<'database' | 'config' | 'free', string> = {
  database: 'text-blue-700',
  config: 'text-amber-700',
  free: 'text-emerald-700',
};

const weekdays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const typeLabel = (type: BackupKind) => {
  if (type === 'full') return 'نسخة احتياطية كاملة';
  if (type === 'inventory') return 'نسخة بيانات المخزون';
  if (type === 'config') return 'نسخة الإعدادات';
  return 'لقطة أمان قبل الاستعادة';
};

const actorLabel = (entry: BackupHistoryEntry) => {
  if (entry.actor.type === 'user') {
    const name = entry.actor.username || String(entry.actor.userId || 'مستخدم');
    return `${name} (${triggerLabel(entry.trigger)})`;
  }
  return `النظام (${triggerLabel(entry.trigger)})`;
};

const cardClasses = 'rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-xl shadow-sm';

const BackupCenter: React.FC<BackupCenterProps> = ({ currentUser }) => {
  const { hasPermission } = usePermissions();
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
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(0);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
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

  const normalizedRole = String(currentUser?.role || currentUser?.roleId || '').trim().toLowerCase();
  const isPrivilegedRole = normalizedRole === 'admin' || normalizedRole === 'superadmin';
  const canCreate = hasPermission('backup.create');
  const canSchedule = hasPermission('backup.schedule') && isPrivilegedRole;
  const canRestore = hasPermission('backup.restore') && isPrivilegedRole;
  const canDownload = hasPermission('backup.download');
  const canDelete = hasPermission('backup.delete') && isPrivilegedRole;

  const createActionLabel = useMemo(() => {
    if (activeType === 'inventory') return 'إنشاء نسخة بيانات المخزون';
    if (activeType === 'config') return 'إنشاء نسخة الإعدادات';
    return 'إنشاء نسخة كاملة';
  }, [activeType]);

  const hydrateSchedule = (stats: BackupStorageStats | null) => {
    if (!stats?.schedule) return;
    const schedule = stats.schedule;
    setScheduleEnabled(Boolean(schedule.enabled));
    setScheduleFrequency(schedule.frequency);
    setScheduleHour(schedule.hour);
    setScheduleMinute(schedule.minute);
    setScheduleDayOfWeek(schedule.dayOfWeek);
    setScheduleDayOfMonth(schedule.dayOfMonth);
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
    if (!canSchedule) {
      toast.error('لا تملك صلاحية تعديل جدولة النسخ الاحتياطية.');
      return;
    }

    if (storageTargets.length === 0) {
      toast.error('اختر وجهة تخزين واحدة على الأقل.');
      return;
    }

    setSavingSchedule(true);
    try {
      await saveBackupSchedule({
        enabled: scheduleEnabled,
        frequency: scheduleFrequency,
        hour: scheduleHour,
        minute: scheduleMinute,
        dayOfWeek: scheduleDayOfWeek,
        dayOfMonth: scheduleDayOfMonth,
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
    if (!canDownload) {
      toast.error('لا تملك صلاحية تنزيل النسخ الاحتياطية.');
      return;
    }

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
    if (!canDelete) {
      toast.error('لا تملك صلاحية حذف النسخ الاحتياطية.');
      return;
    }

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
    if (!canRestore) {
      toast.error('لا تملك صلاحية الاستعادة.');
      return;
    }

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
    if (!canRestore) {
      toast.error('لا تملك صلاحية الاستعادة.');
      return;
    }

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
    <div className="space-y-6 font-[Tajawal]" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={`${cardClasses} p-5`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Shield className="text-blue-600" size={24} /> لوحة النسخ الاحتياطي والاستعادة
            </h2>
            <p className="text-sm text-slate-600 mt-1">إدارة النسخ اليدوية والمجدولة مع التحقق من السلامة، التنزيل، والاستعادة الآمنة عبر لقطة حماية مسبقة.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadData(false)}
            disabled={refreshing}
            className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
          <div className="xl:col-span-1 grid grid-cols-1 gap-3">
            {(storage?.segments || []).map((segment) => (
              <div key={segment.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className={`text-sm font-bold ${segmentTextClass[segment.key]}`}>{segment.label}</div>
                <div className="mt-2 text-2xl font-black text-slate-900">{formatBytes(segment.valueBytes)}</div>
                <div className="mt-1 text-xs text-slate-500">{segment.percentage.toFixed(1)}% من المساحة المعروضة</div>
              </div>
            ))}
          </div>

          <div className="xl:col-span-2 space-y-2">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
              <div className="font-bold text-slate-800">آخر نسخة احتياطية: {formatDateTime(latestBackup?.createdAt || storage?.latestBackup?.createdAt || null)}</div>
              <div className="text-slate-600 mt-1">الحجم: {formatBytes(latestBackup?.sizeBytes || storage?.latestBackup?.sizeBytes || 0)}</div>
              <div className="mt-1 flex items-center gap-2">
                {(latestBackup?.integrity || storage?.latestBackup?.integrity) === 'verified' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><ShieldCheck size={14} />تم التحقق من السلامة</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-700 font-semibold"><ShieldAlert size={14} />فشل التحقق من السلامة</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm">
              <div className="font-bold text-slate-800 inline-flex items-center gap-1"><Clock3 size={14} />موعد التشغيل القادم</div>
              <div className="text-slate-600 mt-1">{formatDateTime(storage?.schedule?.nextRunAt || null)}</div>
              <div className="text-slate-600 mt-1">استخدام المساحة الحالية: {Number(storage?.usagePercent || 0).toFixed(1)}%</div>
              <div className="text-slate-600 mt-1">التكرار الحالي: {frequencyLabel(scheduleFrequency)}</div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {(storage?.segments || []).map((segment) => (
                <div key={segment.key} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className={`font-semibold ${segmentTextClass[segment.key]}`}>{segment.label}</div>
                  <div className="text-slate-600">{segment.percentage.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }} className={`${cardClasses} p-5`}>
        <h3 className="text-lg font-bold text-slate-900 mb-3">تصفية السجل حسب النوع</h3>
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
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">إعدادات الجدولة والحماية</h3>
            <p className="text-sm text-slate-600 mt-1">اضبط وقت التشغيل، مدة الاحتفاظ، وجهات التخزين، ورمز الاستعادة قبل تنفيذ أي استرجاع.</p>
          </div>
          {!canSchedule && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 border border-amber-200">عرض فقط</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-sm text-slate-700">
            التكرار
            <select value={scheduleFrequency} onChange={(event) => setScheduleFrequency(event.target.value as 'daily' | 'weekly' | 'monthly')} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500">
              <option value="daily">يومي</option>
              <option value="weekly">أسبوعي</option>
              <option value="monthly">شهري</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            الساعة
            <input type="number" min={0} max={23} value={scheduleHour} onChange={(event) => setScheduleHour(Number(event.target.value || 0))} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500" />
          </label>

          <label className="text-sm text-slate-700">
            الدقيقة
            <input type="number" min={0} max={59} value={scheduleMinute} onChange={(event) => setScheduleMinute(Number(event.target.value || 0))} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500" />
          </label>

          <label className="text-sm text-slate-700">
            مدة الاحتفاظ بالأيام
            <input type="number" min={1} max={3650} value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value || 30))} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500" />
          </label>
        </div>

        {scheduleFrequency === 'weekly' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <label className="text-sm text-slate-700">
              يوم التشغيل الأسبوعي
              <select value={scheduleDayOfWeek} onChange={(event) => setScheduleDayOfWeek(Number(event.target.value || 0))} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500">
                {weekdays.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {scheduleFrequency === 'monthly' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <label className="text-sm text-slate-700">
              يوم التشغيل الشهري
              <input type="number" min={1} max={31} value={scheduleDayOfMonth} onChange={(event) => setScheduleDayOfMonth(Number(event.target.value || 1))} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500" />
            </label>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <label className="text-sm text-slate-700">
            كلمة مرور التشفير AES-256 (اختياري)
            <input type="password" value={encryptionPassword} onChange={(event) => setEncryptionPassword(event.target.value)} disabled={!canSchedule} className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500" placeholder="******" />
          </label>

          <label className="text-sm text-slate-700">
            رمز الاستعادة PIN
            <input type="password" value={restorePin} onChange={(event) => setRestorePin(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" placeholder="PIN من 4 أرقام أو أكثر" />
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
                disabled={!canSchedule}
                onClick={() =>
                  setStorageTargets((prev) =>
                    prev.includes(target) ? prev.filter((item) => item !== target) : [...prev, target],
                  )
                }
                className={`px-3 py-1.5 rounded-lg border disabled:bg-slate-100 disabled:text-slate-500 ${checked ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 bg-white'}`}
              >
                {storageTargetLabel[target]}
              </button>
            );
          })}

          <button
            type="button"
            disabled={!canSchedule}
            onClick={() => setScheduleEnabled((value) => !value)}
            className={`px-3 py-1.5 rounded-lg border disabled:bg-slate-100 disabled:text-slate-500 ${scheduleEnabled ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            الجدولة: {scheduleEnabled ? 'مفعلة' : 'متوقفة'}
          </button>

          <button
            type="button"
            disabled={!canSchedule}
            onClick={() => setEncryptionEnabled((value) => !value)}
            className={`px-3 py-1.5 rounded-lg border disabled:bg-slate-100 disabled:text-slate-500 ${encryptionEnabled ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            التشفير: {encryptionEnabled ? 'مفعل' : 'متوقف'}
          </button>

          <button
            type="button"
            onClick={handleSaveSchedule}
            disabled={savingSchedule || !canSchedule}
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
              {busyType === activeType ? 'جارٍ إنشاء النسخة...' : createActionLabel}
            </button>
          </div>
          <button type="button" onClick={() => void runBackup('inventory')} disabled={busyType !== null || !canCreate} className="rounded-xl px-4 py-3 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60">{busyType === 'inventory' ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة المخزون'}</button>
          <button type="button" onClick={() => void runBackup('config')} disabled={busyType !== null || !canCreate} className="rounded-xl px-4 py-3 bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60">{busyType === 'config' ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة الإعدادات'}</button>
        </div>
        <div className="mt-3 rounded-xl px-4 py-3 bg-slate-100 border border-slate-200 text-slate-700 text-sm font-semibold inline-flex items-center justify-center gap-2">
          <ShieldCheck size={16} /> الاستعادة تتطلب رمز PIN صالح، وصلاحية استعادة، ودورًا إداريًا.
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
                  <th className="py-2 text-right">التاريخ</th>
                  <th className="py-2 text-right">النوع</th>
                  <th className="py-2 text-right">الحجم</th>
                  <th className="py-2 text-right">الحماية</th>
                  <th className="py-2 text-right">المنفذ</th>
                  <th className="py-2 text-right">الإجراءات</th>
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
                        <button type="button" onClick={() => void handleDownload(entry)} disabled={!canDownload} className="p-1.5 rounded hover:bg-slate-100 text-slate-700 disabled:opacity-40" title="تنزيل">
                          <Download size={14} />
                        </button>
                        <button type="button" onClick={() => void openRestorePreview(entry)} disabled={!canRestore} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-700 disabled:opacity-40" title="استعادة">
                          <HardDrive size={14} />
                        </button>
                        <button type="button" onClick={() => void handleDelete(entry)} disabled={!canDelete} className="p-1.5 rounded hover:bg-red-50 text-red-700 disabled:opacity-40" title="حذف">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-slate-500">لا توجد نسخ احتياطية مطابقة للنوع المحدد حتى الآن.</td>
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
              <Shield size={20} className="text-blue-600" /> تأكيد استعادة النسخة الاحتياطية
            </h4>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>النسخة المستهدفة: <strong>{typeLabel(restoreTarget.type)}</strong></p>
              <p>تاريخ النسخة: <strong>{formatDateTime(restoreTarget.createdAt)}</strong></p>
              <p>لقطة الأمان المسبقة: <strong>{safetySnapshotId || 'لم يتم الإنشاء بعد'}</strong></p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
              <p className="font-semibold inline-flex items-center gap-1"><AlertTriangle size={14} /> سيتم استبدال بيانات النظام الحالية بمحتوى النسخة المحددة بعد إتمام التحقق النهائي.</p>
              <p className="mt-1">تم إنشاء لقطة أمان تلقائيًا قبل الاستعادة حتى يمكن الرجوع عنها عند الحاجة.</p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreConfirm()}
                disabled={restoring}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {restoring ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} تأكيد الاستعادة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupCenter;

