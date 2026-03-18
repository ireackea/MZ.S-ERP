// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 1.6 - Final Perfection Pass - 2026-03-02
import { useState, useEffect } from 'react';
import { mutationQueueService } from '../services/mutationQueueService';
import { toast } from '@services/toastService';
import { stopRealtimeSync, startRealtimeSync } from '../services/realtimeSync';

export const useOfflineSync = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Poll for pending count changes
  useEffect(() => {
    const updateCount = async () => {
      const count = await mutationQueueService.getQueueSize();
      setPendingCount(count);
    };
    
    updateCount();
    const interval = setInterval(updateCount, 2000);
    return () => clearInterval(interval);
  }, []);

  // PWA Install Prompt - after 3 days of use
  useEffect(() => {
    const checkPWAInstall = () => {
      const firstVisit = localStorage.getItem('ff_pw_first_visit');
      if (!firstVisit) {
        localStorage.setItem('ff_pw_first_visit', Date.now().toString());
        return;
      }

      const daysUsing = (Date.now() - parseInt(firstVisit)) / (1000 * 60 * 60 * 24);
      if (daysUsing > 3 && !localStorage.getItem('ff_pw_prompt_shown')) {
        window.addEventListener('beforeinstallprompt', (e: any) => {
          e.preventDefault();
          toast('8!8 778y7 7778y7 FeedFactory 87778y8 8&77887', {
            duration: 10000,
            action: {
              label: '7778y7 787778y8',
              onClick: () => {
                e.prompt();
                localStorage.setItem('ff_pw_prompt_shown', 'true');
              }
            }
          });
        });
      }
    };
    
    checkPWAInstall();
  }, []);

  useEffect(() => {
    const handleOnline = async () => {
      setIsOffline(false);
      const socket = startRealtimeSync(); // Resume Socket.io
      
      // Configure Exponential Backoff (1s to 30s)
      if (socket && (socket as any).io) {
        (socket as any).io.reconnectionDelay(1000);
        (socket as any).io.reconnectionDelayMax(30000);
      }

      toast.success('78&7 7777777 7877778 7787787. 8y78& 7878  8&778&8 7 7878y78 77...');
      setIsSyncing(true);
      await mutationQueueService.sync();
      setIsSyncing(false);
      toast.success('78&7 8&778&8 7 7878y78 77 78 777!');
    };

    const handleOffline = () => {
      setIsOffline(true);
      stopRealtimeSync(); // Halt Socket.io reconnections while offline
      toast.warning('78 7 7878  778&8 8~8y 877 78788~878y8  (7788  77778). 78y78& 78~7 7778y8778 88&778&8 78!7 8778789.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial socket state based on network
    if (navigator.onLine) {
      startRealtimeSync();
    } else {
      stopRealtimeSync();
    }

    // Initial check
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const executeWithSync = async (
    url: string, 
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', 
    body: any,
    localAction: () => void | Promise<void>
  ) => {
    // Optimistic UI update
    await localAction();

    if (isOffline) {
      await mutationQueueService.enqueue(url, method, body);
      toast.info('78& 78~7 7878&88y7 8&788y789 (788~878y8 ).');
      return { offline: true };
    } else {
      try {
        const { default: apiClient } = await import('../api/client');
        await apiClient.request({ url, method, data: body });
        return { offline: false };
      } catch (error: any) {
        // Fallback to queue if network failed
        if (!error.response) {
          await mutationQueueService.enqueue(url, method, body);
          setIsOffline(true); // Trigger offline mode
          toast.warning('8~78 7877778 7787778&. 78& 7788y8 7878&88y7 7880 78788~878y8 .');
          return { offline: true };
        }
        throw error;
      }
    }
  };

  return { isOffline, isSyncing, pendingCount, executeWithSync };
};

