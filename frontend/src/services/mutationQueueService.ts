// ENTERPRISE FIX: Phase 1.6 - Final Perfection Pass - 2026-03-02
import apiClient from '../api/client';
import { toast } from '@services/toastService';

const DB_NAME = 'FeedFactoryMutationDB';
const STORE_NAME = 'mutationQueue';
const DB_VERSION = 1;

export interface MutationTask {
  id: string;
  url: string;
  method: string;
  body: any;
  timestamp: number;
}

export const mutationQueueService = {
  dbPromise: null as Promise<IDBDatabase> | null,

  init() {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      this.dbPromise = null;
      return;
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  },

  async enqueue(url: string, method: string, body: any) {
    // ENTERPRISE FIX: Phase 1.5 - PWA + Background Sync - 2026-03-02
    if (!this.dbPromise) this.init();
    if (!this.dbPromise) return;
    const db = await this.dbPromise!;
    const task: MutationTask = {
      id: crypto.randomUUID(),
      url,
      method,
      body,
      timestamp: Date.now()
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(task);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Request Background Sync from Service Worker
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await (registration as any).sync.register('sync-mutations');
        console.log('[MutationQueue] Background sync registered.');
      } catch (err) {
        console.error('[MutationQueue] Background sync registration failed', err);
      }
    }
  },

  async getQueue(): Promise<MutationTask[]> {
    if (!this.dbPromise) this.init();
    if (!this.dbPromise) return [];
    const db = await this.dbPromise!;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async clearTask(id: string) {
    if (!this.dbPromise) return;
    const db = await this.dbPromise!;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject();
    });
  },

  async getQueueSize() {
    const queue = await this.getQueue();
    return queue.length;
  },

  async sync() {
    console.log('[MutationQueue] Starting sync...');
    const queue = await this.getQueue();
    // Sort by timestamp
    queue.sort((a, b) => a.timestamp - b.timestamp);
    
    for (const task of queue) {
      try {
        await apiClient.request({
          url: task.url,
          method: task.method,
          data: task.body
        });
        await this.clearTask(task.id);
      } catch (error: any) {
        console.error('[MutationQueue] Sync failed for task', task.id, error);
        // Conflict resolution: Server Wins (HTTP 409 Conflict)
        if (error.response && error.response.status === 409) {
          console.warn('[MutationQueue] Conflict detected (Server Wins). Dropping local mutation.');
          
          toast('7�8& 7�7�7�8y8 7�87�7�8y7� 8&8  87�8 7�7�7� 7�7�7�. 7�7�7�8� 7�7�7�8y7� 7�8y7�8 7�7�8�.', {
            action: {
              label: '7�7�7� 7�87�8~7�7�8y8',
              onClick: () => {
                window.dispatchEvent(new CustomEvent('show-conflict-modal', {
                  detail: { task, serverData: error.response.data }
                }));
              }
            }
          });
          
          await this.clearTask(task.id);
        }
      }
    }
  }
};

// Auto-init
mutationQueueService.init();

