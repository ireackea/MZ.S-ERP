// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// FC-SEC-003 — no shared secret may live in the client bundle.
// The session HttpOnly cookie plus RbacGuard are the only authority; a
// VITE_-prefixed token would be inlined into public JavaScript.
import apiClient from '@api/client';

const withBackupHeaders = (headers?: Record<string, string>) => {
  const baseHeaders: Record<string, string> = { ...(headers || {}) };
  return baseHeaders;
};

/**
 * B5 / B13 — the one answer to "can I lose everything right now and get it back".
 *
 * Read by the dashboard, the reset screen and `App`, all from the same endpoint, so
 * the three cannot tell the operator different things about the same archive.
 */
export type BackupVerdict = 'ok' | 'stale' | 'unhealthy' | 'none';

export interface BackupHealth {
  verdict: BackupVerdict;
  summary: string;
  lastBackup: {
    id: string;
    type: string;
    createdAt: string;
    ageMs: number;
    ageHours: number;
    sizeBytes: number;
    integrity: string;
    restorable: boolean;
  } | null;
  archiveCount: number;
  restorableCount: number;
  threeTwoOne: {
    copies: number;
    storageLocations: number;
    offSite: number;
    satisfied: boolean;
    note: string;
  };
  schedule: {
    enabled: boolean;
    lastRunAt: string | null;
    frequency: string;
    nextRunAtHint: string;
  } | null;
  problems: Array<{ code: string; severity: 'error' | 'warning'; message: string }>;
}

/**
 * `verify: true` re-reads every archive rather than answering from the cache. An
 * operator auditing their backups needs a measurement, not a recent recollection.
 */
export async function fetchBackupHealth(options: { verify?: boolean } = {}): Promise<BackupHealth | null> {
  try {
    const response = await apiClient.get(
      options.verify ? '/backup/health?verify=1' : '/backup/health',
      { headers: withBackupHeaders() },
    );
    return unwrap<BackupHealth>(response.data);
  } catch {
    // A health check that throws must not blank the screen. `null` means "unknown",
    // and the callers render that as unknown rather than as healthy — which is the
    // whole difference this endpoint exists to make.
    return null;
  }
}

export type BackupKind = 'full' | 'inventory' | 'config' | 'safety_snapshot';

export interface BackupImportResult {
  backup: BackupHistoryEntry;
  /** The archive is older than the retention window, so the next backup may delete it. */
  atRiskOfImmediatePrune: boolean;
  warnings: string[];
}

export interface BackupHistoryEntry {
  id: string;
  fileName: string;
  type: BackupKind;
  trigger: 'manual' | 'scheduled' | 'import';
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
    // B9 — the other two retention rules. Sending them matters as much as showing
    // them: the schedule endpoint accepts unknown keys and discards them, so a
    // control that saves without the service understanding the field produces a
    // setting that governs nothing and reports no error.
    maxCount: number;
    minCount: number;
    maxSafetySnapshots: number;
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
  maxCount?: number;
  minCount?: number;
  maxSafetySnapshots?: number;
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

/**
 * B2 — a refusal has to reach the operator in words.
 *
 * The service answers 409 for the two deletions that must not happen (the last
 * copy, a snapshot an unconfirmed restore depends on). Axios rejects a non-2xx
 * before the `success === false` check below can run, so the rejection's message
 * is the generic "Request failed with status code 409" and the reason — the part
 * that tells the operator what to do instead — is dropped. Read it off the
 * response body.
 */
/**
 * B21 — the way back in.
 *
 * Sent as `multipart` rather than as a base64 JSON field, and not as a style choice:
 * an archive carries the whole database as base64 already, so a JSON body would hold
 * a second full copy in memory on both sides on top of the multipart buffers. A file
 * that cannot be uploaded is the same dead end as a file that cannot be read.
 */
export async function importBackupFile(file: File): Promise<BackupImportResult> {
  const form = new FormData();
  form.append('file', file, file.name);

  let response;
  try {
    response = await apiClient.post('/backup/import', form, {
      headers: withBackupHeaders(),
    });
  } catch (error: any) {
    // A large upload is the case most likely to be refused in transit, by a proxy
    // rather than by this service, and a proxy's 413 carries no message the operator
    // can act on — axios reports only "Request failed with status code 413".
    const status = error?.response?.status;
    if (status === 413) {
      throw new Error(
        'حجم الملف أكبر من الذي يسمح به الخادم الوكيل. ارفع `client_max_body_size` في إعدادات nginx أو صدّر الملف من داخل الشبكة.',
      );
    }
    const body = error?.response?.data;
    if (body?.success === false) {
      throw new Error(body?.message || body?.error || 'تعذّر استيراد النسخة.');
    }
    throw error;
  }

  const payload = response.data;
  if (payload?.success === false) {
    throw new Error(payload?.message || payload?.error || 'تعذّر استيراد النسخة.');
  }
  return payload?.data as BackupImportResult;
}

export async function removeBackup(backupId: string): Promise<boolean> {
  let response;
  try {
    response = await apiClient.delete(`/backup/${encodeURIComponent(backupId)}`, {
      headers: withBackupHeaders(),
    });
  } catch (error: any) {
    const body = error?.response?.data;
    if (body?.success === false) {
      throw new Error(body?.message || body?.error || 'تعذر حذف النسخة الاحتياطية.');
    }
    throw error;
  }
  const payload = response.data;
  if (payload?.success === false) {
    throw new Error(payload?.message || payload?.error || 'Delete failed');
  }
  return Boolean(payload?.data?.deleted);
}

