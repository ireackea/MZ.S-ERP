// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import { User } from '../types';

const NOTIFICATION_LOGS_KEY = 'feed_factory_notification_logs';

function readLogs(): Array<Record<string, any>> {
  const raw = localStorage.getItem(NOTIFICATION_LOGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, any>>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLogs(logs: Array<Record<string, any>>) {
  localStorage.setItem(NOTIFICATION_LOGS_KEY, JSON.stringify(logs.slice(0, 500)));
}

export async function notifyBackupFailureAdmins(params: {
  admins: User[];
  message: string;
  slackWebhookUrl?: string;
}) {
  const logs = readLogs();
  const timestamp = Date.now();

  params.admins.forEach((admin) => {
    logs.unshift({
      id: crypto.randomUUID(),
      type: 'BACKUP_FAILURE_EMAIL',
      timestamp,
      userId: admin.id,
      userEmail: admin.email,
      message: params.message,
      status: admin.email ? 'queued-simulated' : 'skipped-no-email',
    });
  });

  if (params.slackWebhookUrl) {
    try {
      await fetch(params.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `[Backup Failure] ${params.message}` }),
      });
      logs.unshift({
        id: crypto.randomUUID(),
        type: 'BACKUP_FAILURE_WEBHOOK',
        timestamp,
        message: params.message,
        status: 'sent',
      });
    } catch {
      logs.unshift({
        id: crypto.randomUUID(),
        type: 'BACKUP_FAILURE_WEBHOOK',
        timestamp,
        message: params.message,
        status: 'failed',
      });
    }
  }

  saveLogs(logs);
}

