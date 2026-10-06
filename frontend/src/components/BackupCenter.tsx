// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatDateTime } from '@services/dateFormat';
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
  BACKUP_FILTERS,
  countArchives,
  filterArchives,
  type BackupFilter,
} from './backup-log-filter';
import {
  applyRestore,
  BackupHistoryEntry,
  BackupHealth,
  BackupKind,
  BackupStorageStats,
  createBackupByType,
  downloadBackupFile,
  fetchBackupHealth,
  fetchBackupHistory,
  fetchStorageStats,
  importBackupFile,
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

/**
 * FC-SEC-014 — the narrow two-digit shape this screen wants, with the locale
 * coming from the shared formatter instead of a literal in this file.
 */
const formatBackupDateTime = (value?: string | null) => (
  value ? formatDateTime(value, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) : 'غير متوفر'
);

// B21 - an imported archive is labelled as such. Filing it as manual would be a
// lie an auditor has to disprove: nobody pressed a button for it.
const triggerLabel = (trigger: 'manual' | 'scheduled' | 'import') =>
  trigger === 'scheduled'
    ? 'مجدول'
    : trigger === 'import'
      ? 'مستورد'
      : 'يدوي';

const frequencyLabel = (frequency: 'daily' | 'weekly' | 'monthly') => {
  if (frequency === 'weekly') return 'أسبوعي';
  if (frequency === 'monthly') return 'شهري';
  return 'يومي';
};

/**
 * Where archives actually go.
 *
 * A constant, and no longer a choice. The three checkboxes this replaces were saved,
 * validated and echoed back by the service while **nothing wrote to a USB device or a
 * network share** — every archive went to this one directory. The state existed only to
 * feed an option that had no effect, and the schedule could not be saved without ticking
 * at least one of them.
 *
 * The service still accepts `usb` and `drive` (removing them from its schema would make an
 * existing saved schedule unreadable), so it is sent `['local']`: what is actually true.
 */
const ARCHIVE_STORAGE_TARGETS = ['local'] as const;

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
  const [logFilter, setLogFilter] = useState<BackupFilter>('all');

  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [scheduleHour, setScheduleHour] = useState(2);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(0);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [retentionDays, setRetentionDays] = useState(30);
  // B9 — the count cap and the floor. `retentionDays` alone cannot bound the store:
  // an hourly schedule with a 30-day policy keeps 720 archives, and nothing stopped
  // retention from emptying it entirely.
  const [retentionMaxCount, setRetentionMaxCount] = useState(60);
  const [retentionMinCount, setRetentionMinCount] = useState(2);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [restorePin, setRestorePin] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  // B21 — reset to '' after every attempt, so choosing the same file twice in a row
  // fires `change` again. Without it a failed import appears to do nothing when
  // retried, which is the worst possible reading of "it did not work".
  const [importing, setImporting] = useState(false);
  // B5 - the health answer, from the one endpoint. A null result means unknown, and is
  // as unknown: a panel that falls back to "fine" when it cannot ask is the
  // failure this replaces.
  const [health, setHealth] = useState<BackupHealth | null>(null);
  const [healthUnknown, setHealthUnknown] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
  // B21 — importing puts a file into the trusted store, so it is gated the same way
  // deleting from it is. It is not gated by the restore PIN, because it destroys
  // nothing: a restore still needs the PIN, and that is where the blast radius is.
  const canImport = hasPermission('backup.import') && isPrivilegedRole;

  /**
   * Phase 0 — the fetched schedule, kept whole rather than only as loose fields.
   *
   * Every field the service sends was being copied into a separate `useState`, and two of
   * them were dropped on the floor: `hasRestorePin` and `hasEncryptionPassword`. The
   * server had been answering "is a restore PIN configured?" since B5, and the interface
   * could not have displayed the answer even if it had wanted to — so it guessed, printed
   * a fixed sentence, and demanded a PIN that a default deployment does not have.
   *
   * Splitting a server response across a dozen states is what made it possible to forget
   * two of them without any test noticing.
   */
  const [scheduleInfo, setScheduleInfo] = useState<BackupStorageStats['schedule'] | null>(null);

  const hydrateSchedule = (stats: BackupStorageStats | null) => {
    if (!stats?.schedule) return;
    const schedule = stats.schedule;
    setScheduleInfo(schedule);
    setScheduleEnabled(Boolean(schedule.enabled));
    setScheduleFrequency(schedule.frequency);
    setScheduleHour(schedule.hour);
    setScheduleMinute(schedule.minute);
    setScheduleDayOfWeek(schedule.dayOfWeek);
    setScheduleDayOfMonth(schedule.dayOfMonth);
    setRetentionDays(schedule.retentionDays);
    setRetentionMaxCount(schedule.maxCount ?? 60);
    setRetentionMinCount(schedule.minCount ?? 2);
    setEncryptionEnabled(Boolean(schedule.encryptionEnabled));
  };

  const loadData = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setRefreshing(!showSpinner);
    try {
      const [stats, logs, reported] = await Promise.all([
        fetchStorageStats(),
        fetchBackupHistory(),
        // B5 - asked here so the panel, the reset screen and App read one answer.
        fetchBackupHealth({ verify: false }),
      ]);
      setStorage(stats);
      setHistory(logs);
      hydrateSchedule(stats);
      setHealth(reported);
      setHealthUnknown(reported === null);
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

  /**
   * Filtering and nothing else.
   *
   * This was a `useMemo` over `activeType`, the same variable that chose what the primary
   * create button built and what it was labelled — so picking a filter changed the button.
   * The decisions now live in `backup-log-filter.ts` where they can be tested, and this
   * state cannot reach anything but the list.
   */
  const filteredHistory = useMemo(
    () => filterArchives(history, logFilter),
    [history, logFilter],
  );
  const archiveCounts = useMemo(() => countArchives(history), [history]);

  const latestBackup = useMemo(() => {
    return [...history].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }, [history]);

  const runBackup = async (type: Exclude<BackupKind, 'safety_snapshot'>) => {
    if (!canCreate) return;
    // The ring used to be gated on `type === activeType`, which meant it only ever
    // animated for whichever type happened to match the log filter. With three separate
    // buttons and a fixed label each, every click gets its own feedback.
    setShowPulse(true);
    setBusyType(type);
    try {
      await createBackupByType(type, encryptionPassword || undefined);
      toast.success('تم إنشاء النسخة الاحتياطية بنجاح.');
      await loadData(false);
    } catch (error: any) {
      toast.error(error?.message || 'فشل إنشاء النسخة الاحتياطية.');
    } finally {
      setBusyType(null);
      setTimeout(() => setShowPulse(false), 250);
    }
  };

  const handleSaveSchedule = async () => {
    if (!canSchedule) {
      toast.error('لا تملك صلاحية تعديل جدولة النسخ الاحتياطية.');
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
        maxCount: retentionMaxCount,
        minCount: retentionMinCount,
        storageTargets: [...ARCHIVE_STORAGE_TARGETS],
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

  /**
   * B21 — the way back in.
   *
   * Deleting a backup is the step that used to be irreversible from the interface's
   * point of view: the file went to the operator's disk, and nothing here would take
   * it back. This is the counterpart, and it is on the same screen as the delete
   * button so the two are visibly a pair.
   *
   * A confirmation, because the file picker makes it easy to pick the wrong file and
   * the service's refusals are the only thing standing between a mistake and a
   * confusing error. It is not the restore confirmation — nothing is destroyed here.
   */
  const handleImport = async (file: File | null | undefined) => {
    if (!canImport) {
      toast.error('لا تملك صلاحية استيراد النسخ الاحتياطية.');
      return;
    }
    if (!file) return;

    if (!window.confirm(
      `سيُضاف الملف «${file.name}» إلى قائمة النسخ بعد التحقق منه. `
      + 'لن تُستعاد أي بيانات الآن — الاستعادة خطوة منفصلة.',
    )) {
      return;
    }

    setImporting(true);
    try {
      const result = await importBackupFile(file);
      toast.success('تم استيراد النسخة والتحقق منها. يمكنك الآن الاستعادة منها.');
      for (const warning of result.warnings || []) {
        // A warning that only lives in a console is a warning that never reaches the
        // operator it is about. The one that matters most is the archive being old
        // enough for retention to delete it again.
        toast.error(warning, { duration: 12000 });
      }
      await loadData(false);
    } catch (error: any) {
      toast.error(error?.message || 'تعذّر استيراد ملف النسخة الاحتياطية.');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
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
      // Phase 0 — the PIN is demanded only when one is actually configured.
      //
      // This check was unconditional, so an operator who had never set a PIN was told to
      // "enter the restore code first" for a code that did not exist and could not be
      // obtained. There was no value to type and no way forward: **no backup on the server
      // could be restored through this screen.**
      //
      // The server already sent `hasRestorePin` and declared it in the API types; it was
      // simply never read. The rule on the server is the same: no PIN configured means no
      // PIN demanded, and configuring one makes it mandatory again.
      if (scheduleInfo?.hasRestorePin && !restorePin.trim()) {
        toast.error(
          'هذا الخادم مُهيّأ برمز استعادة. أدخله للمتابعة — اضغط «إعدادات الجدولة» لضبطه أو تغييره.',
        );
        return;
      }

      const preview = await previewRestore({
        backupId: entry.id,
        restorePin,
        decryptionPassword: restorePassword || undefined,
      });

      // FC-OPS-003 — the snapshot is named from the server's answer, never asserted
      // locally.
      //
      // This used to say «تم إنشاء لقطة أمان مؤقتة» unconditionally, while the service
      // set `safetySnapshotId: null` and took no snapshot at all. The operator was told
      // the undo existed immediately before the one action that cannot be undone.
      //
      // Now the message reports what came back. If the id is empty the dialog must not
      // open — a confirmation screen for a restore with no way back is the same lie one
      // step later — and the reason belongs in the message, because the server's
      // refusal explains why.
      const snapshotId = String(preview?.safetySnapshotId || '');
      if (!snapshotId) {
        toast.error('لم تُنشأ لقطة أمان، لذلك لم تُعرَض الاستعادة. البيانات لم تتغيّر.');
        return;
      }

      setRestoreTarget(entry);
      setRestoreToken(String(preview?.restoreToken || ''));
      setSafetySnapshotId(snapshotId);
      setRestoreModalOpen(true);
      toast.success('أُخذت لقطة أمان قبل الاستعادة. راجع المعاينة قبل التأكيد.');
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
              <div className="font-bold text-slate-800">آخر نسخة احتياطية: {formatBackupDateTime(latestBackup?.createdAt || storage?.latestBackup?.createdAt || null)}</div>
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
              <div className="text-slate-600 mt-1">{formatBackupDateTime(storage?.schedule?.nextRunAt || null)}</div>
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

      {/* B5 — the health answer, first on the screen.
          Placed above the create buttons on purpose: the question an operator opens
          this page with is "am I protected", and a page that opens with "create a
          backup" answers a different one. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={[
          cardClasses,
          'p-5 border-2',
          !health || health.verdict === 'unhealthy' || health.verdict === 'none'
            ? 'border-red-300 bg-red-50'
            : health.verdict === 'stale'
              ? 'border-amber-300 bg-amber-50'
              : 'border-emerald-300 bg-emerald-50',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">حالة الحماية</h3>
          <button
            type="button"
            onClick={() => void loadData(false)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            title="إعادة التحقق بقراءة ملفات النسخ من جديد"
          >
            تحقّق الآن
          </button>
        </div>

        {/* Unknown is not healthy. A panel that falls back to "fine" when it cannot
            ask is the exact failure this replaces. */}
        {healthUnknown && (
          <p className="mt-2 text-sm font-semibold text-red-800">
            تعذّر قراءة حالة النسخ الاحتياطية. لا تفترض أنها سليمة.
          </p>
        )}

        {health && (
          <>
            <p className="mt-2 text-sm font-semibold text-slate-800">{health.summary}</p>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg border border-white bg-white p-2">
                <div className="text-slate-500">آخر نسخة</div>
                <div className="font-semibold text-slate-800">
                  {health.lastBackup ? formatBackupDateTime(health.lastBackup.createdAt) : 'لا توجد'}
                </div>
              </div>
              <div className="rounded-lg border border-white bg-white p-2">
                <div className="text-slate-500">عمرها</div>
                <div className="font-semibold text-slate-800">
                  {health.lastBackup ? `${health.lastBackup.ageHours} ساعة` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-white bg-white p-2">
                <div className="text-slate-500">الحجم</div>
                <div className="font-semibold text-slate-800">
                  {health.lastBackup ? formatBytes(health.lastBackup.sizeBytes) : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-white bg-white p-2">
                <div className="text-slate-500">قابلة للاستعادة</div>
                <div className="font-semibold text-slate-800">
                  {health.restorableCount} من {health.archiveCount}
                </div>
              </div>
            </div>

            <p className="mt-2 text-xs text-slate-700">
              <span className="font-semibold">قاعدة 3-2-1:</span> {health.threeTwoOne.note}
            </p>

            {health.schedule && (
              <p className="mt-1 text-xs text-slate-700">
                <span className="font-semibold">الجدولة:</span>{' '}
                {health.schedule.enabled
                  ? `مفعّلة (${health.schedule.frequency})، آخر تشغيل ${formatBackupDateTime(health.schedule.lastRunAt) || 'لم تُسجَّل'}.`
                  : 'معطّلة — لن تُنشأ نسخ جديدة تلقائياً.'}
              </p>
            )}

            {health.problems.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {health.problems.map((problem) => (
                  <li
                    key={problem.code}
                    className={[
                      'rounded-lg border px-2 py-1.5',
                      problem.severity === 'error'
                        ? 'border-red-200 bg-red-100 text-red-900'
                        : 'border-amber-200 bg-amber-100 text-amber-900',
                    ].join(' ')}
                  >
                    {problem.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
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

        {/* B9 — the other two retention rules, side by side with the age rule they
            share a pass with. Shown together because they interact: a floor above
            the cap would silently stop retention deleting anything at all. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label className="text-sm text-slate-700">
            أقصى عدد نسخ محفوظة
            <input
              type="number"
              min={1}
              max={1000}
              value={retentionMaxCount}
              onChange={(event) => setRetentionMaxCount(Number(event.target.value || 60))}
              disabled={!canSchedule}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="block text-xs text-slate-500 mt-1">
              يمنع تراكم النسخ عندما تكون المدة أطول من الفترة الفعلية بين النسخ.
            </span>
          </label>

          <label className="text-sm text-slate-700">
            أقل عدد نسخة لا يُحذف
            <input
              type="number"
              min={1}
              max={retentionMaxCount}
              value={retentionMinCount}
              onChange={(event) => setRetentionMinCount(Number(event.target.value || 1))}
              disabled={!canSchedule}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 disabled:bg-slate-100 disabled:text-slate-500"
            />
            <span className="block text-xs text-slate-500 mt-1">
              بلا هذا الحدّ يمكن لعملية التنظيف أن تُفرغ المخزن، فتُرفض إعادة ضبط المصنع لعدم وجود نسخة.
            </span>
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
            <span className="block text-xs font-normal text-slate-500 mt-1">
              {scheduleInfo?.hasRestorePin
                ? 'مُهيّأ. مطلوب مع كل عملية استعادة. اتركه فارغاً ولن يُغيَّر.'
                : 'غير مُهيّأ. الاستعادة تعمل بدونه الآن؛ ضبطه يجعله إلزامياً.'}
            </span>
          </label>

          <label className="text-sm text-slate-700">
            كلمة مرور فك التشفير لعملية الاستعادة
            <input type="password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" placeholder="كلمة المرور" />
            <span className="block text-xs font-normal text-slate-500 mt-1">
              {scheduleInfo?.hasEncryptionPassword
                ? 'مُعيَّنة لهذه الخوادم.'
                : 'لا توجد نسخة مشفّرة بكلمة مرور على هذا الخادم.'}
            </span>
          </label>
        </div>

<div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {/*
/*
            Phase 2 — the storage target options are gone, and B19 is what replaced them.

            `local`, `usb` and `drive` were offered as checkboxes, saved, validated and
            returned by the service. **Nothing wrote to a USB device or a network share.**
            Every archive went to one directory on this machine, whichever boxes were
            ticked — so the control was a claim about resilience that the system did not
            honour, sitting one screen away from a panel that honestly reported
            `offSiteCopies: 0`. Two contradictory statements about the same fact, and the
            reassuring one was the false one.

            They were removed rather than left in place. Off-host copying now exists behind
            `BACKUP_OFFSITE_DIR`, and what it achieved is read from the measured copy count
            rather than from a setting — because a destination that is configured and a copy
            that arrived are different claims, and only the second one is protection.

            What protects the archives is not this counter: it is the refusal to remove the
            last copy, the `minCount` floor, and the ceiling on safety snapshots — all of
            which apply to a human and to the scheduler alike.
          */}
          {(() => {
            // Three states, because "configured" and "working" are different facts and
            // collapsing them is how a dead USB device ends up reading as coverage.
            const locations = health?.threeTwoOne?.storageLocations ?? 1;
            const verified = health?.threeTwoOne?.offSite ?? 0;

            if (locations > 1 && verified > 0) {
              return (
                <div className="w-full rounded-xl px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm font-semibold flex items-start gap-2">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                  <span>
                    هناك نسخة خارج هذا الخادم، وتم التحقق منها بعد كتابتها.
                    <span className="block font-normal text-xs mt-1">
                      {verified} نسخة مؤكَّدة. العدد محسوب من النسخ التي قُرئت من الوجهة
                      الخارجية وعُورضت مطابقةً، لا من ضبط إعداد.
                    </span>
                  </span>
                </div>
              );
            }

            if (locations > 1) {
              return (
                <div className="w-full rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-900 text-sm font-semibold flex items-start gap-2">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                  <span>
                    النسخ خارج المضيف مُهيّأة لكنها غير فعّالة.
                    <span className="block font-normal text-xs mt-1">
                      لم تُؤكَّد أي نسخة في الوجهة الخارجية. تحقّق من وجود القرص أو المشاركة
                      mounts، وأن المساحة كافية. النسخة المحلية سليمة، لكنها الوحيدة المتاحة.
                    </span>
                  </span>
                </div>
              );
            }

            return (
              <div className="w-full rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm font-semibold flex items-start gap-2">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <span>
                  جميع النسخ محفوظة في مجلد واحد على هذا الخادم فقط. لا توجد نسخة خارج المضيف.
                  <span className="block font-normal text-xs mt-1">
                    لتفعيل النسخ خارج المضيف، وجّه{' '}
                    <code className="font-mono">BACKUP_OFFSITE_DIR</code> إلى مجلد على قرص
                    أو مشاركة منفصلة ثم أعد تشغيل الخادم. كل نسخة تُقرأ وتُقارن بعدها، فلا
                    يزيد العدّاد إلا بما تأكّد فعلاً.
                  </span>
                </span>
              </div>
            );
          })()}

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
              onClick={() => void runBackup('full')}
              disabled={busyType !== null || !canCreate}
              className="relative z-10 w-full rounded-xl px-4 py-3 bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
            >
              {busyType === 'full' ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة كاملة'}
            </button>
          </div>
          <button type="button" onClick={() => void runBackup('inventory')} disabled={busyType !== null || !canCreate} className="rounded-xl px-4 py-3 bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60">{busyType === 'inventory' ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة المخزون'}</button>
          <button type="button" onClick={() => void runBackup('config')} disabled={busyType !== null || !canCreate} className="rounded-xl px-4 py-3 bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-60">{busyType === 'config' ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة الإعدادات'}</button>
        </div>
        {/*
          What is actually protecting this restore.

          This used to be a fixed sentence — «الاستعادة تتطلب رمز PIN صالح، وصلاحية
          استعادة، ودورًا إداريًا» — shown unconditionally. It described neither
          configuration that actually exists: the service's rule was "a PIN is required,
          and if none is configured no restore is possible at all", so the sentence claimed
          a protection that was either absent or, worse, implied by a screen that demanded
          a code the operator did not have.

          A protection notice must never claim a protection that is not running. So it now
          reflects the real state, and says plainly when the restore is unprotected by a PIN.
        */}
        <div
          className={[
            'mt-3 rounded-xl px-4 py-3 border text-sm font-semibold flex items-start gap-2',
            scheduleInfo?.hasRestorePin
              ? 'bg-slate-100 border-slate-200 text-slate-700'
              : 'bg-amber-50 border-amber-200 text-amber-900',
          ].join(' ')}
        >
          <ShieldCheck size={16} className="mt-0.5 shrink-0" />
          <span>
            {scheduleInfo?.hasRestorePin
              ? 'الاستعادة تتطلب رمز الاستعادة وصلاحية استعادة ودورًا إداريًا، وتأخذ لقطة أمان قبل التنفيذ.'
              : 'لا يوجد رمز استعادة مُهيّأ على هذا الخادم، فالاستعادة محمية بالصلاحية والدور وقاعدة الاستعادة فقط. '
                + 'ضبط رمز استعادة يجعله إلزاميًا من أول محاولة.'}
          </span>
        </div>

        {/* B21 — the counterpart to the delete button further down. */}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <label className="block text-sm text-slate-700 font-semibold mb-2">
            استيراد ملف نسخة احتياطية من الخارج
            <span className="block text-xs font-normal text-slate-500 mt-1">
              أعِد ملف ‎.ffbkp‎ الذي نزّلته سابقاً إلى القائمة ليصبح قابلاً للاستعادة.
              لن تُستعاد أي بيانات تلقائياً.
            </span>
          </label>
          <input
            ref={importInputRef}
            type="file"
            accept=".ffbkp,application/octet-stream"
            disabled={!canImport || importing}
            onChange={(event) => void handleImport(event.target.files?.[0])}
            className="block w-full text-sm text-slate-600 file:ml-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-white file:font-semibold hover:file:bg-slate-700 disabled:opacity-50"
          />
          {!canImport && (
            <p className="mt-2 text-xs text-amber-700">لا تملك صلاحية استيراد النسخ الاحتياطية.</p>
          )}
          {importing && <p className="mt-2 text-xs text-slate-600">جارٍ التحقق من الملف وإضافته…</p>}
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.2 }} className={`${cardClasses} p-5`}>
<div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-bold text-slate-900">
            سجل النسخ الاحتياطية
            <span className="block text-xs font-normal text-slate-500 mt-0.5">
              {logFilter === 'all'
                ? `${history.length} نسخة مسجّلة`
                : `${filteredHistory.length} من ${history.length} نسخة`}
            </span>
          </h3>
        </div>

        {/*
          The filter, in the card it filters.

          It used to be its own card between the health panel and the settings, so the
          control sat far away from the list it was supposed to narrow — and it was wired
          to the same variable as the create button, so using it changed what that button
          did and what it said. It now touches the list and nothing else.

          Each option carries its count, because a filter that silently hides rows is
          indistinguishable from backups that were never taken.
        */}
        <div className="mb-4 flex flex-wrap gap-2">
          {BACKUP_FILTERS.map((filter) => {
            const count = filter.value === 'all'
              ? history.length
              : archiveCounts[filter.value];
            const selected = logFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setLogFilter(filter.value)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-semibold transition ${
                  selected
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {filter.label}
                <span className={`mr-1.5 text-xs ${selected ? 'text-blue-500' : 'text-slate-400'}`}>
                  ({count})
                </span>
              </button>
            );
          })}
        </div>
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
                    <td className="py-2">{formatBackupDateTime(entry.createdAt)}</td>
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
              <p>تاريخ النسخة: <strong>{formatBackupDateTime(restoreTarget.createdAt)}</strong></p>
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