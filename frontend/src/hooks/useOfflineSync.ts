// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 1.6 - Final Perfection Pass - 2026-03-02
import { useSyncExternalStore } from 'react';
import { mutationQueueService } from '../services/mutationQueueService';
import { AUTH_SESSION_EVENT, getAuthUser } from '@services/authSession';
import { toast } from '@services/toastService';
import { assertStorageKeyAllowed } from '../services/storageOwnership';
import { stopRealtimeSync, startRealtimeSync } from '../services/realtimeSync';

type OfflineSyncSnapshot = {
  isOffline: boolean;
  isSyncing: boolean;
  /**
   * Tasks genuinely waiting to be sent: `pending` plus `processing`.
   *
   * This used to be the queue's `total`, so a task the server *refused* was counted as
   * waiting to be sent. The two answers point an operator at opposite actions — "let it
   * sync" versus "your permission was refused, this will never sync" — and only one of
   * them is actionable by waiting.
   */
  pendingCount: number;
  /** Refused by the server with 401/403. Retrying cannot help; a permission must change. */
  blockedCount: number;
  /** Everything in the queue, whatever its state. */
  totalCount: number;
  conflictCount: number;
  failedCount: number;
  deadLetterCount: number;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<unknown>;
  preventDefault: () => void;
};

let snapshot: OfflineSyncSnapshot = {
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  isSyncing: false,
  pendingCount: 0,
  blockedCount: 0,
  totalCount: 0,
  conflictCount: 0,
  failedCount: 0,
  deadLetterCount: 0,
};

const subscribers = new Set<() => void>();

let activeConsumers = 0;
let activeOwnerId = '';
let pendingCountInterval: ReturnType<typeof setInterval> | null = null;
let runtimeListenersBound = false;
let serviceWorkerRegistrationAttempted = false;
let installPromptListenerBound = false;

const emitSnapshot = () => {
  subscribers.forEach((subscriber) => subscriber());
};

const setSnapshot = (partial: Partial<OfflineSyncSnapshot>) => {
  const nextSnapshot = {
    ...snapshot,
    ...partial,
  } satisfies OfflineSyncSnapshot;

  if (
    nextSnapshot.isOffline === snapshot.isOffline &&
    nextSnapshot.isSyncing === snapshot.isSyncing &&
    nextSnapshot.pendingCount === snapshot.pendingCount &&
    nextSnapshot.conflictCount === snapshot.conflictCount &&
    nextSnapshot.failedCount === snapshot.failedCount &&
    nextSnapshot.deadLetterCount === snapshot.deadLetterCount
  ) {
    return;
  }

  snapshot = nextSnapshot;
  emitSnapshot();
};

const readSnapshot = () => snapshot;

const refreshPendingCount = async () => {
  try {
    const stats = await mutationQueueService.getQueueStats();
    setSnapshot({
      pendingCount: stats.pending + stats.processing,
      blockedCount: stats.blocked,
      totalCount: stats.total,
      conflictCount: stats.conflicts,
      failedCount: stats.failed,
      deadLetterCount: stats.deadLetter,
    });
  } catch (error) {
    console.error('Failed to read mutation queue stats:', error);
  }
};

const hasAuthenticatedSession = () => Boolean(getAuthUser());

const isTransactionMutation = (url: string) => url === '/transactions' || url.startsWith('/transactions/');

const enqueueWithQuotaHandling = async (
  url: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  body: any,
  headers?: Record<string, string>,
) => {
  try {
    await mutationQueueService.enqueue(url, method, body, headers);
  } catch (error: any) {
    if (String(error?.message || '').includes('QUOTA')) {
      toast.warning('امتلأت مساحة التخزين المحلي. تم إيقاف حفظ العمليات بدون اتصال.');
    }
    throw error;
  }
};

const ensureInstallPromptListener = () => {
  if (installPromptListenerBound || typeof window === 'undefined') {
    return;
  }

  assertStorageKeyAllowed('ff_pw_first_visit');
  const firstVisit = localStorage.getItem('ff_pw_first_visit');
  if (!firstVisit) {
    assertStorageKeyAllowed('ff_pw_first_visit');
    localStorage.setItem('ff_pw_first_visit', Date.now().toString());
    return;
  }

  const daysUsing = (Date.now() - parseInt(firstVisit, 10)) / (1000 * 60 * 60 * 24);
  assertStorageKeyAllowed('ff_pw_prompt_shown');
  if (daysUsing <= 3 || localStorage.getItem('ff_pw_prompt_shown')) {
    return;
  }

  const handleBeforeInstallPrompt = (event: Event) => {
    const promptEvent = event as BeforeInstallPromptEvent;
    promptEvent.preventDefault();
    toast('يمكنك تثبيت تطبيق FeedFactory للحصول على تجربة أسرع بدون اتصال.', {
      duration: 10000,
      action: {
        label: 'تثبيت التطبيق',
        onClick: () => {
          void promptEvent.prompt();
          assertStorageKeyAllowed('ff_pw_prompt_shown');
          localStorage.setItem('ff_pw_prompt_shown', 'true');
        },
      },
    });
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
  installPromptListenerBound = true;
};

const ensureServiceWorkerRegistration = () => {
  if (
    serviceWorkerRegistrationAttempted ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }

  serviceWorkerRegistrationAttempted = true;
  void navigator.serviceWorker.register('/sw.js')
    .then((registration) => {
      console.log('Service Worker registered with scope:', registration.scope);
    })
    .catch((error) => {
      console.error('Service Worker registration failed:', error);
    });
};

const configureRealtimeBackoff = () => {
  if (!hasAuthenticatedSession()) {
    stopRealtimeSync();
    return null;
  }

  const socket = startRealtimeSync();
  if (socket && (socket as any).io) {
    (socket as any).io.reconnectionDelay(1000);
    (socket as any).io.reconnectionDelayMax(30000);
  }

  return socket;
};

const syncQueue = async () => {
  if (!hasAuthenticatedSession()) return;
  setSnapshot({ isSyncing: true });
  try {
    const result = await mutationQueueService.sync();
    if (result && (result.failed > 0 || result.conflicts > 0 || result.blocked > 0 || result.deadLetter > 0)) {
      toast.warning('تعذر مزامنة بعض التغييرات. راجع قائمة العمليات المعلقة.');
    } else {
      toast.success('تمت مزامنة التغييرات بنجاح.');
    }
  } catch (error) {
    console.error('Offline sync failed:', error);
    toast.warning('تعذر إكمال مزامنة التغييرات. سيُعاد المحاولة عند توفر الاتصال بشكل مستقر.');
  } finally {
    await refreshPendingCount();
    setSnapshot({ isSyncing: false });
  }
};

const handleOnline = async () => {
  setSnapshot({ isOffline: false });
  configureRealtimeBackoff();
  toast.success('تم استعادة الاتصال بالشبكة. ستبدأ مزامنة التغييرات الآن...');
  await syncQueue();
};

const handleOffline = () => {
  setSnapshot({ isOffline: true, isSyncing: false });
  stopRealtimeSync();
  toast.warning('أنت الآن تعمل بدون اتصال. سيتم حفظ التغييرات محليًا ومزامنتها تلقائيًا عند عودة الاتصال.');
};

const handleAuthSessionChanged = () => {
  const nextOwnerId = String(getAuthUser()?.id || '');
  if (activeOwnerId && activeOwnerId !== nextOwnerId) {
    void mutationQueueService.quarantineOwner(activeOwnerId);
  }
  activeOwnerId = nextOwnerId;
  if (nextOwnerId) {
    void mutationQueueService.resumeOwner(nextOwnerId).then(() => {
      if (navigator.onLine) void syncQueue();
    });
  }
  if (readSnapshot().isOffline) {
    stopRealtimeSync();
    return;
  }

  configureRealtimeBackoff();
};

const handleServiceWorkerMessage = (event: MessageEvent) => {
  if (event.data?.type === 'FEED_FACTORY_QUEUE_REPLAY') void syncQueue();
};

const startRuntime = () => {
  if (typeof window === 'undefined') {
    return;
  }

  activeConsumers += 1;
  if (activeConsumers !== 1) {
    return;
  }

  activeOwnerId = String(getAuthUser()?.id || '');
  setSnapshot({ isOffline: !navigator.onLine });
  void refreshPendingCount();

  pendingCountInterval = setInterval(() => {
    void refreshPendingCount();
  }, 2000);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  window.addEventListener(AUTH_SESSION_EVENT, handleAuthSessionChanged);
  window.addEventListener('message', handleServiceWorkerMessage);
  runtimeListenersBound = true;

  if (navigator.onLine) {
    configureRealtimeBackoff();
  } else {
    stopRealtimeSync();
  }

  ensureInstallPromptListener();
  ensureServiceWorkerRegistration();
};

const stopRuntime = () => {
  if (typeof window === 'undefined') {
    return;
  }

  activeConsumers = Math.max(0, activeConsumers - 1);
  if (activeConsumers !== 0) {
    return;
  }

  if (pendingCountInterval) {
    clearInterval(pendingCountInterval);
    pendingCountInterval = null;
  }

  if (runtimeListenersBound) {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener(AUTH_SESSION_EVENT, handleAuthSessionChanged);
    window.removeEventListener('message', handleServiceWorkerMessage);
    runtimeListenersBound = false;
  }

  stopRealtimeSync();
  setSnapshot({ isSyncing: false });
};

const subscribe = (onStoreChange: () => void) => {
  subscribers.add(onStoreChange);
  startRuntime();

  return () => {
    subscribers.delete(onStoreChange);
    stopRuntime();
  };
};

export const useOfflineSync = () => {
  const state = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);

  const executeWithSync = async (
    url: string,
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    body: any,
    localAction?: () => void | Promise<void>,
    headers?: Record<string, string>,
  ) => {
    const transactionMutation = isTransactionMutation(url);

    if (readSnapshot().isOffline) {
      if (transactionMutation) {
        toast.warning('حفظ الحركات بدون اتصال معطل مؤقتًا. سجّل الحركة عند عودة الاتصال.');
        throw new Error('OFFLINE_TRANSACTION_POSTING_DISABLED');
      }

      await enqueueWithQuotaHandling(url, method, body, headers);
      await localAction?.();
      await refreshPendingCount();
      toast.info('تم حفظ العملية محليًا لأنها نُفذت بدون اتصال.');
      return { offline: true };
    }

    try {
      const { default: apiClient } = await import('../api/client');
      const response = await apiClient.request({ url, method, data: body, headers });
      await localAction?.();
      return { offline: false, data: response.data };
    } catch (error: any) {
      if (!error.response) {
        if (transactionMutation) {
          setSnapshot({ isOffline: true });
          toast.warning('تعذر تأكيد الحركة على الخادم. لم يتم حفظها محليًا لتجنب التكرار.');
          throw error;
        }

        await enqueueWithQuotaHandling(url, method, body, headers);
        await localAction?.();
        await refreshPendingCount();
        setSnapshot({ isOffline: true });
        toast.warning('تعذر الوصول إلى الخادم. تم حفظ العملية محليًا إلى حين استعادة الاتصال.');
        return { offline: true };
      }

      throw error;
    }
  };

  const retryFailed = async () => {
    await mutationQueueService.retryOwner();
    await refreshPendingCount();
    if (!readSnapshot().isOffline) await syncQueue();
  };

  /**
   * Gate 4.8 — the queue's actual contents, for the screen that tells an operator a
   * permission is missing.
   *
   * Counts are not an answer to "which permission?". A blocked task names the URL
   * and the method that were refused, and the panel used to render neither, so the
   * operator was told to change a permission with no way to find out which one.
   */
  const queueTasks = async () => mutationQueueService.getQueue();

  return { ...state, executeWithSync, retryFailed, queueTasks };
};

