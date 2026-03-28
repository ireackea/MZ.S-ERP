// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
// ENTERPRISE FIX: Legacy Migration Phase 4 - Stocktaking + Themes + Backup - 2026-02-27
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import {
  CheckSquare,
  Download,
  HardDrive,
  Loader2,
  RefreshCcw,
  Save,
  Shield,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from '@services/toastService';
import { usePermissions } from '@hooks/usePermissions';
import {
  applyRestore,
  createBackupByType,
  downloadBackupFile,
  fetchBackupHistory,
  fetchStorageStats,
  previewRestore,
  removeBackup,
  saveBackupSchedule,
  type BackupHistoryEntry,
  type BackupKind,
  type BackupStorageStats,
} from '../services/backupCenterApi';

type ScheduleForm = {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  retentionDays: number;
  storageTargets: Array<'local' | 'usb' | 'drive'>;
  encryptionEnabled: boolean;
  encryptionPassword: string;
  restorePin: string;
};

type RestorePreviewState = {
  backupId: string;
  backupLabel: string;
  restoreToken: string;
  safetySnapshotId: string;
};

type BackupStore = {
  history: BackupHistoryEntry[];
  stats: BackupStorageStats | null;
  loading: boolean;
  refreshing: boolean;
  busyType: Exclude<BackupKind, 'safety_snapshot'> | null;
  error: string | null;
  loadData: () => Promise<void>;
  createBackup: (type: Exclude<BackupKind, 'safety_snapshot'>, encryptionPassword?: string) => Promise<void>;
  deleteBackup: (id: string) => Promise<void>;
  downloadBackup: (id: string) => Promise<{ fileName: string; blob: Blob; checksum: string }>;
};

const useBackupStore = create<BackupStore>((set, get) => ({
  history: [],
  stats: null,
  loading: false,
  refreshing: false,
  busyType: null,
  error: null,

  loadData: async () => {
    const firstLoad = get().history.length === 0;
    set({ loading: firstLoad, refreshing: !firstLoad, error: null });
    try {
      const [history, stats] = await Promise.all([fetchBackupHistory(), fetchStorageStats()]);
      set({ history, stats, loading: false, refreshing: false });
    } catch (error: any) {
      set({
        loading: false,
        refreshing: false,
        error: error?.response?.data?.message || error?.message || 'Failed to load backup center data.',
      });
    }
  },

  createBackup: async (type, encryptionPassword) => {
    set({ busyType: type });
    try {
      await createBackupByType(type, encryptionPassword || undefined);
      await get().loadData();
    } finally {
      set({ busyType: null });
    }
  },

  deleteBackup: async (id) => {
    await removeBackup(id);
    set((state) => ({ history: state.history.filter((row) => String(row.id) !== String(id)) }));
  },

  downloadBackup: async (id) => {
    return downloadBackupFile(id);
  },
}));

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
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const BackupCenterPage: React.FC = () => {
  const { hasPermission } = usePermissions();
  const { history, stats, loading, refreshing, busyType, error, loadData, createBackup, deleteBackup, downloadBackup } =
    useBackupStore();

  const [activeType, setActiveType] = useState<Exclude<BackupKind, 'safety_snapshot'>>('full');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm>({
    enabled: true,
    frequency: 'daily',
    hour: 2,
    minute: 0,
    dayOfWeek: 0,
    dayOfMonth: 1,
    retentionDays: 30,
    storageTargets: ['local'],
    encryptionEnabled: true,
    encryptionPassword: '',
    restorePin: '',
  });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restorePreviewState, setRestorePreviewState] = useState<RestorePreviewState | null>(null);
  const [restorePin, setRestorePin] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [previewingId, setPreviewingId] = useState<string>('');
  const [exportingFullBackup, setExportingFullBackup] = useState(false);

  const canView = hasPermission('*') || hasPermission('backup.view');
  const canCreate = hasPermission('*') || hasPermission('backup.create');
  const canDelete = hasPermission('*') || hasPermission('backup.delete');
  const canRestore = hasPermission('*') || hasPermission('backup.restore');
  const canSchedule = hasPermission('*') || hasPermission('backup.schedule');

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const s = stats?.schedule;
    if (!s) return;
    setScheduleForm((prev) => ({
      ...prev,
      enabled: Boolean(s.enabled),
      frequency: s.frequency,
      hour: s.hour,
      minute: s.minute,
      dayOfWeek: s.dayOfWeek,
      dayOfMonth: s.dayOfMonth,
      retentionDays: s.retentionDays,
      storageTargets: s.storageTargets,
      encryptionEnabled: s.encryptionEnabled,
      encryptionPassword: '',
      restorePin: '',
    }));
  }, [stats?.schedule]);

  const filteredHistory = useMemo(
    () =>
      history.filter((row) => {
        if (activeType === 'full') {
          return row.type === 'full' || row.type === 'safety_snapshot';
        }
        return row.type === activeType;
      }),
    [history, activeType],
  );

  const selectAllChecked =
    filteredHistory.length > 0 &&
    filteredHistory.every((row) => selectedIds.has(String(row.id)));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selectAllChecked) filteredHistory.forEach((row) => next.delete(String(row.id)));
      else filteredHistory.forEach((row) => next.add(String(row.id)));
      return next;
    });
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onCreateBackup = async (type: Exclude<BackupKind, 'safety_snapshot'>) => {
    if (!canCreate) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½" 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    try {
      await createBackup(type, scheduleForm.encryptionPassword || undefined);
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½" 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½" 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    }
  };

  const onExportFullSystemBackup = async () => {
    if (!canCreate) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½" 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    setExportingFullBackup(true);
    try {
      await createBackup('full', scheduleForm.encryptionPassword || undefined);
      const fullHistory = await fetchBackupHistory('full');
      const latestFull = fullHistory.find((entry) => entry.type === 'full');
      if (!latestFull) throw new Error('No full backup found after creation.');

      const file = await downloadBackup(String(latestFull.id));
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } finally {
      setExportingFullBackup(false);
    }
  };

  const onDownload = async (id: string) => {
    try {
      const file = await downloadBackup(id);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    }
  };

  const onDelete = async (id: string) => {
    if (!canDelete) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    try {
      await deleteBackup(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(String(id));
        return next;
      });
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    }
  };

  const onPurgeSelected = async () => {
    if (!canDelete) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ purge.');
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const confirmed = window.confirm(`Purge ${ids.length} backup(s)?`);
    if (!confirmed) return;
    try {
      for (const id of ids) {
        await deleteBackup(id);
      }
      setSelectedIds(new Set());
      toast.success(`7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ ${ids.length} 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½%7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.`);
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  purge 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    }
  };

  const onSaveSchedule = async () => {
    if (!canSchedule) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    setSavingSchedule(true);
    try {
      await saveBackupSchedule({
        enabled: scheduleForm.enabled,
        frequency: scheduleForm.frequency,
        hour: scheduleForm.hour,
        minute: scheduleForm.minute,
        dayOfWeek: scheduleForm.dayOfWeek,
        dayOfMonth: scheduleForm.dayOfMonth,
        retentionDays: scheduleForm.retentionDays,
        storageTargets: scheduleForm.storageTargets,
        encryptionEnabled: scheduleForm.encryptionEnabled,
        encryptionPassword: scheduleForm.encryptionPassword || undefined,
        restorePin: scheduleForm.restorePin || undefined,
      });
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
      setScheduleForm((prev) => ({ ...prev, encryptionPassword: '', restorePin: '' }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const onPreviewRestore = async (row: BackupHistoryEntry) => {
    if (!canRestore) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    if (!restorePin.trim()) return toast.error('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  Restore PIN 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½.');
    setPreviewingId(String(row.id));
    try {
      const preview = await previewRestore({
        backupId: String(row.id),
        restorePin,
        decryptionPassword: restorePassword || undefined,
      });
      setRestorePreviewState({
        backupId: String(row.id),
        backupLabel: row.fileName,
        restoreToken: String(preview?.restoreToken || ''),
        safetySnapshotId: String(preview?.safetySnapshotId || ''),
      });
      setRestoreModalOpen(true);
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½ï؟½" 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } finally {
      setPreviewingId('');
    }
  };

  const onConfirmRestore = async () => {
    if (!restorePreviewState) return;
    setRestoring(true);
    try {
      await applyRestore({
        backupId: restorePreviewState.backupId,
        restoreToken: restorePreviewState.restoreToken,
        restorePin,
        decryptionPassword: restorePassword || undefined,
      });
      toast.success('7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
      setRestoreModalOpen(false);
      setRestorePreviewState(null);
      await loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.');
    } finally {
      setRestoring(false);
    }
  };

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <div className="mb-2 flex items-center gap-2 text-base font-bold">
          <ShieldAlert size={18} />
          <span>7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½7:7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½ï؟½ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½</span>
        </div>
        <p className="text-sm">7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ <code>backup.view</code>.</p>
      </div>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              <Shield size={20} />
              Backup Center
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½7:7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCcw size={15} className={refreshing ? 'animate-spin' : ''} />
            7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Database</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{formatBytes(Number(stats?.databaseBytes || 0))}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Backups</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{formatBytes(Number(stats?.backupsBytes || 0))}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Free</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{formatBytes(Number(stats?.freeBytes || 0))}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Usage</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{Number(stats?.usagePercent || 0).toFixed(1)}%</p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(['full', 'inventory', 'config'] as Array<Exclude<BackupKind, 'safety_snapshot'>>).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setActiveType(type)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                activeType === type
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-300'
                  : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
              }`}
            >
              {type.toUpperCase()}
            </button>
          ))}

          <button
            type="button"
            disabled={busyType !== null || !canCreate}
            onClick={() => void onCreateBackup(activeType)}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {busyType === activeType ? '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½...' : `Create ${activeType.toUpperCase()} Backup`}
          </button>

          <button
            type="button"
            disabled={exportingFullBackup || busyType !== null || !canCreate}
            onClick={() => void onExportFullSystemBackup()}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            {exportingFullBackup ? '7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½...' : 'Export Full System Backup'}
          </button>

          <button
            type="button"
            onClick={() => void onPurgeSelected()}
            disabled={!selectedIds.size || !canDelete}
            className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <Trash2 size={14} />
            Purge Selected ({selectedIds.size})
          </button>
        </div>

        {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <tr>
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={toggleSelectAll}>
                    {selectAllChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-3 py-2 text-right">Date</th>
                <th className="px-3 py-2 text-right">File</th>
                <th className="px-3 py-2 text-right">Type</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2 text-right">Integrity</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9  7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½...
                    </span>
                  </td>
                </tr>
              )}
              {!loading && filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½ï؟½ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½ 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½#ï؟½ï؟½ï؟½9 7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½#ï؟½â‘"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½7ï؟½"ï؟½.</td>
                </tr>
              )}
              {!loading && filteredHistory.map((row) => {
                const id = String(row.id);
                return (
                  <tr key={id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => toggleSelectOne(id)}>
                        {selectedIds.has(id) ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.fileName}</td>
                    <td className="px-3 py-2">{row.type}</td>
                    <td className="px-3 py-2">{formatBytes(Number(row.sizeBytes || 0))}</td>
                    <td className="px-3 py-2">
                      {row.integrityVerified ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          Verified
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void onDownload(id)}
                          className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={previewingId === id || !canRestore}
                          onClick={() => void onPreviewRestore(row)}
                          className="rounded-lg border border-emerald-300 p-1.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                        >
                          <HardDrive size={14} />
                        </button>
                        <button
                          type="button"
                          disabled={!canDelete}
                          onClick={() => void onDelete(id)}
                          className="rounded-lg border border-red-300 p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-3 text-base font-bold text-slate-900 dark:text-slate-100">Schedule</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <select
            value={scheduleForm.frequency}
            onChange={(event) => setScheduleForm((prev) => ({ ...prev, frequency: event.target.value as ScheduleForm['frequency'] }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input
            type="number"
            min={0}
            max={23}
            value={scheduleForm.hour}
            onChange={(event) => setScheduleForm((prev) => ({ ...prev, hour: Number(event.target.value || 0) }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Hour"
          />
          <input
            type="number"
            min={0}
            max={59}
            value={scheduleForm.minute}
            onChange={(event) => setScheduleForm((prev) => ({ ...prev, minute: Number(event.target.value || 0) }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Minute"
          />
          <input
            type="number"
            min={1}
            max={3650}
            value={scheduleForm.retentionDays}
            onChange={(event) => setScheduleForm((prev) => ({ ...prev, retentionDays: Number(event.target.value || 30) }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Retention Days"
          />
          <input
            type="password"
            value={scheduleForm.restorePin}
            onChange={(event) => setScheduleForm((prev) => ({ ...prev, restorePin: event.target.value }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Restore PIN"
          />
          <input
            type="password"
            value={scheduleForm.encryptionPassword}
            onChange={(event) => setScheduleForm((prev) => ({ ...prev, encryptionPassword: event.target.value }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Encryption Password"
          />
          <button
            type="button"
            onClick={() => setScheduleForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
              scheduleForm.enabled
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-300'
                : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
            }`}
          >
            {scheduleForm.enabled ? 'Schedule Enabled' : 'Schedule Disabled'}
          </button>
          <button
            type="button"
            disabled={savingSchedule || !canSchedule}
            onClick={() => void onSaveSchedule()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {savingSchedule ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Schedule
          </button>
        </div>
      </section>

      <AnimatePresence>
        {restoreModalOpen && restorePreviewState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Confirm Restore</h3>
                <button
                  type="button"
                  onClick={() => {
                    setRestoreModalOpen(false);
                    setRestorePreviewState(null);
                  }}
                  className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                <p><strong>Backup:</strong> {restorePreviewState.backupLabel}</p>
                <p><strong>Safety Snapshot:</strong> {restorePreviewState.safetySnapshotId || '-'}</p>
                <p><strong>Token:</strong> {restorePreviewState.restoreToken.slice(0, 16)}...</p>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRestoreModalOpen(false);
                    setRestorePreviewState(null);
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => void onConfirmRestore()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  {restoring && <Loader2 size={14} className="animate-spin" />}
                  Confirm Restore
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
};

export default BackupCenterPage;

