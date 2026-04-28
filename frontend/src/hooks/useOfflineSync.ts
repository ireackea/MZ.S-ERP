// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 1.6 - Final Perfection Pass - 2026-03-02
import { useSyncExternalStore } from 'react';
import { mutationQueueService } from '../services/mutationQueueService';
import { AUTH_SESSION_EVENT, getAuthUser } from '@services/authSession';
import { toast } from '@services/toastService';
import { stopRealtimeSync, startRealtimeSync } from '../services/realtimeSync';

type OfflineSyncSnapshot = {
  isOffline: boolean;
  isSyncing: boolean;
  pendingCount: number;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<unknown>;
  preventDefault: () => void;
};

let snapshot: OfflineSyncSnapshot = {
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  isSyncing: false,
  pendingCount: 0,
};

const subscribers = new Set<() => void>();

let activeConsumers = 0;
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
    nextSnapshot.pendingCount === snapshot.pendingCount
  ) {
    return;
  }

  snapshot = nextSnapshot;
  emitSnapshot();
};

const readSnapshot = () => snapshot;

const refreshPendingCount = async () => {
  const count = await mutationQueueService.getQueueSize();
  setSnapshot({ pendingCount: count });
};

const hasAuthenticatedSession = () => Boolean(getAuthUser());

const ensureInstallPromptListener = () => {
  if (installPromptListenerBound || typeof window === 'undefined') {
    return;
  }

  const firstVisit = localStorage.getItem('ff_pw_first_visit');
  if (!firstVisit) {
    localStorage.setItem('ff_pw_first_visit', Date.now().toString());
    return;
  }

  const daysUsing = (Date.now() - parseInt(firstVisit, 10)) / (1000 * 60 * 60 * 24);
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

const handleOnline = async () => {
  setSnapshot({ isOffline: false });
  configureRealtimeBackoff();

  toast.success('تم استعادة الاتصال بالشبكة. ستبدأ مزامنة التغييرات الآن...');
  setSnapshot({ isSyncing: true });

  try {
    await mutationQueueService.sync();
    toast.success('تمت مزامنة التغييرات بنجاح.');
  } catch (error) {
    console.error('Offline sync failed:', error);
    toast.warning('تعذر إكمال مزامنة التغييرات. سيُعاد المحاولة عند توفر الاتصال بشكل مستقر.');
  } finally {
    await refreshPendingCount();
    setSnapshot({ isSyncing: false });
  }
};

const handleOffline = () => {
  setSnapshot({ isOffline: true, isSyncing: false });
  stopRealtimeSync();
  toast.warning('أنت الآن تعمل بدون اتصال. سيتم حفظ التغييرات محليًا ومزامنتها تلقائيًا عند عودة الاتصال.');
};

const handleAuthSessionChanged = () => {
  if (readSnapshot().isOffline) {
    stopRealtimeSync();
    return;
  }

  configureRealtimeBackoff();
};

const startRuntime = () => {
  if (typeof window === 'undefined') {
    return;
  }

  activeConsumers += 1;
  if (activeConsumers !== 1) {
    return;
  }

  setSnapshot({ isOffline: !navigator.onLine });
  void refreshPendingCount();

  pendingCountInterval = setInterval(() => {
    void refreshPendingCount();
  }, 2000);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  window.addEventListener(AUTH_SESSION_EVENT, handleAuthSessionChanged);
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
    localAction: () => void | Promise<void>,
  ) => {
    await localAction();

    if (readSnapshot().isOffline) {
      await mutationQueueService.enqueue(url, method, body);
      await refreshPendingCount();
      toast.info('تم حفظ العملية محليًا لأنها نُفذت بدون اتصال.');
      return { offline: true };
    }

    try {
      const { default: apiClient } = await import('../api/client');
      await apiClient.request({ url, method, data: body });
      return { offline: false };
    } catch (error: any) {
      if (!error.response) {
        await mutationQueueService.enqueue(url, method, body);
        await refreshPendingCount();
        setSnapshot({ isOffline: true });
        toast.warning('تعذر الوصول إلى الخادم. تم حفظ العملية محليًا إلى حين استعادة الاتصال.');
        return { offline: true };
      }

      throw error;
    }
  };

  return { ...state, executeWithSync };
};

