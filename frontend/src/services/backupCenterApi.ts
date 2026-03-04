// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import apiClient from '@api/client';

const BACKUP_API_TOKEN =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKUP_API_TOKEN
    ? String(import.meta.env.VITE_BACKUP_API_TOKEN)
    : '';

const withBackupHeaders = (headers?: Record<string, string>) => {
  const baseHeaders: Record<string, string> = { ...(headers || {}) };
  if (BACKUP_API_TOKEN) {
    baseHeaders['x-backup-token'] = BACKUP_API_TOKEN;
  }
  return baseHeaders;
};

export type BackupKind = 'full' | 'inventory' | 'config' | 'safety_snapshot';

export interface BackupHistoryEntry {
  id: string;
  fileName: string;
  type: BackupKind;
  trigger: 'manual' | 'scheduled';
  createdAt: string;
  sizeBytes: number;
  checksumSha256: string;
  integrity: 'verified' | 'failed';
  integrityVerified: boolean;
  integrityLabel: 'verified' | 'failed';
  passwordProtected: boolean;
  actor: {
    type: 'user' | 'system';
    mode: 'manual' | 'scheduled';
    userId?: number;
    username?: string;
    role?: string;
  };
  metadata: {
    users: number;
    items: number;
    openingBalances: number;
    transactions: number;
    configFiles: number;
  };
  safetySnapshotForId?: string | null;
}

export interface BackupStorageStats {
  generatedAt: string;
  databaseBytes: number;
  configBytes: number;
  backupsBytes: number;
  freeBytes: number;
  totalBytes: number;
  usagePercent: number;
  latestBackup: null | {
    id: string;
    createdAt: string;
    sizeBytes: number;
    type: BackupKind;
    integrity: 'verified' | 'failed';
  };
  schedule: {
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'monthly';
    hour: number;
    minute: number;
    dayOfWeek: number;
    dayOfMonth: number;
    retentionDays: number;
    storageTargets: Array<'local' | 'usb' | 'drive'>;
    encryptionEnabled: boolean;
    hasEncryptionPassword: boolean;
    hasRestorePin: boolean;
    lastRunAt: string | null;
    updatedAt: string;
    nextRunAt: string | null;
  };
  segments: Array<{
    key: 'database' | 'config' | 'free';
    label: string;
    color: string;
    valueBytes: number;
    percentage: number;
  }>;
}

const unwrap = <T>(payload: any): T => {
  if (payload?.success === false) {
    throw new Error(payload?.message || payload?.error || 'Backup API error');
  }
  return payload?.data as T;
};

export async function fetchBackupHistory(type?: BackupKind): Promise<BackupHistoryEntry[]> {
  const response = await apiClient.get('/backup/list', {
    params: type ? { type } : undefined,
    headers: withBackupHeaders(),
  });
  return unwrap<BackupHistoryEntry[]>(response.data) || [];
}

export async function createBackupByType(type: Exclude<BackupKind, 'safety_snapshot'>, encryptionPassword?: string) {
  const response = await apiClient.post(
    `/backup/${type}`,
    { encryptionPassword: encryptionPassword || undefined },
    { headers: withBackupHeaders() },
  );
  return unwrap<BackupHistoryEntry>(response.data);
}

export async function fetchStorageStats(): Promise<BackupStorageStats> {
  const response = await apiClient.get('/backup/storage-stats', {
    headers: withBackupHeaders(),
  });
  return unwrap<BackupStorageStats>(response.data);
}

export async function saveBackupSchedule(payload: {
  enabled?: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly';
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  retentionDays?: number;
  storageTargets?: Array<'local' | 'usb' | 'drive'>;
  encryptionEnabled?: boolean;
  encryptionPassword?: string;
  restorePin?: string;
}) {
  const response = await apiClient.post('/backup/schedule', payload, {
    headers: withBackupHeaders(),
  });
  return unwrap(response.data);
}

export async function previewRestore(params: {
  backupId: string;
  restorePin: string;
  decryptionPassword?: string;
}) {
  const response = await apiClient.post(
    '/backup/restore',
    {
      backupId: params.backupId,
      restorePin: params.restorePin,
      decryptionPassword: params.decryptionPassword || undefined,
      confirmRestore: false,
    },
    { headers: withBackupHeaders() },
  );

  if (response.data?.success === false) {
    throw new Error(response.data?.message || response.data?.error || 'Restore preview failed');
  }

  return response.data?.data;
}

export async function applyRestore(params: {
  backupId: string;
  restorePin: string;
  restoreToken: string;
  decryptionPassword?: string;
}) {
  const response = await apiClient.post(
    '/backup/restore',
    {
      backupId: params.backupId,
      restorePin: params.restorePin,
      restoreToken: params.restoreToken,
      decryptionPassword: params.decryptionPassword || undefined,
      confirmRestore: true,
    },
    { headers: withBackupHeaders() },
  );

  if (response.data?.success === false) {
    throw new Error(response.data?.message || response.data?.error || 'Restore failed');
  }

  return response.data?.data;
}

export async function downloadBackupFile(backupId: string): Promise<{ fileName: string; blob: Blob; checksum: string }> {
  const response = await apiClient.get(`/backup/download/${encodeURIComponent(backupId)}`, {
    responseType: 'blob',
    headers: withBackupHeaders(),
  });

  const disposition = String(response.headers?.['content-disposition'] || '');
  const checksum = String(response.headers?.['x-backup-checksum'] || '');

  const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const fileName = match?.[1] || `backup_${backupId}.ffbkp`;

  return {
    fileName,
    blob: response.data as Blob,
    checksum,
  };
}

export async function removeBackup(backupId: string): Promise<boolean> {
  const response = await apiClient.delete(`/backup/${encodeURIComponent(backupId)}`, {
    headers: withBackupHeaders(),
  });
  const payload = response.data;
  if (payload?.success === false) {
    throw new Error(payload?.message || payload?.error || 'Delete failed');
  }
  return Boolean(payload?.data?.deleted);
}

