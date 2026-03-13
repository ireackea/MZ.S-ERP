const CACHE_NAME = 'feedfactory-pwa-v3';
const DYNAMIC_CACHE = 'feedfactory-api-v3';
const MUTATION_DB_NAME = 'FeedFactoryMutationDB';
const MUTATION_STORE_NAME = 'mutationQueue';
const CORE_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching core assets...');
      return cache.addAll(CORE_ASSETS);
    }).catch((err) => {
      console.error('[Service Worker] Cache install failed:', err);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE) {
            console.log('[Service Worker] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Activation complete');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // High-Priority Data (Dashboard & Items): Stale-While-Revalidate for instant offline UX
  if ((url.pathname.includes('/api/dashboard') || url.pathname.includes('/api/items')) && event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
          return networkResponse;
        }).catch((err) => {
          console.log('[Service Worker] Network failed, using cache for:', url.pathname);
          return cachedResponse;
        });
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // API GET Requests: Network First, fallback to cache
  if (url.pathname.startsWith('/api') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const resClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(event.request, resClone);
            });
          }
          return response;
        })
        .catch(() => {
          console.log('[Service Worker] API offline, trying cache for:', url.pathname);
          return caches.match(event.request);
        })
    );
    return;
  }

  if (url.pathname.startsWith('/api') && event.request.method !== 'GET') {
    return;
  }

  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => {
        console.log('[Service Worker] Static asset offline, trying cache for:', url.pathname);
        return caches.match(event.request);
      })
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-mutations') {
    console.log('[Service Worker] Background sync triggered: sync-mutations');
    event.waitUntil(processMutationQueue());
  }
});

function openMutationDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MUTATION_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(MUTATION_STORE_NAME)) {
        db.createObjectStore(MUTATION_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function readAllQueuedTasks(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MUTATION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
}

function deleteQueuedTask(db, taskId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MUTATION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(MUTATION_STORE_NAME);
    const request = store.delete(taskId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function processMutationQueue(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  const BACKOFF_BASE_MS = 2000;

  console.log(`[Service Worker] processMutationQueue - Attempt ${attempt}/${MAX_ATTEMPTS}`);

  try {
    const db = await openMutationDb();
    const tasks = await readAllQueuedTasks(db);

    if (tasks.length === 0) {
      console.log('[Service Worker] No pending tasks in queue.');
      return;
    }

    tasks.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`[Service Worker] Processing ${tasks.length} tasks. Attempt: ${attempt}`);

    let successCount = 0;
    let conflictCount = 0;
    let errorCount = 0;

    for (const task of tasks) {
      try {
        console.log(`[Service Worker] Syncing task ${task.id}: ${task.method} ${task.url}`);

        const response = await fetch(task.url, {
          method: task.method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(task.body)
        });

        if (response.ok) {
          console.log(`[Service Worker] Task ${task.id} synced successfully (Status: ${response.status})`);
          successCount++;
          await deleteQueuedTask(db, task.id);
        } else if (response.status === 409) {
          console.warn(`[Service Worker] Conflict 409 detected for task ${task.id}. Server has newer version.`);
          conflictCount++;

          self.clients.matchAll().then((clients) => {
            clients.forEach((client) => {
              client.postMessage({
                type: 'CONFLICT_DETECTED',
                task: task,
                serverData: null, // سيتم جلبها من قبل العميل
                message: 'تم اكتشاف تعارض - يرجى مراجعة البيانات'
              });
            });
          });

          await deleteQueuedTask(db, task.id);

          console.log(`[Service Worker] Task ${task.id} removed from queue - client will handle conflict`);
        } else {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`[Service Worker] Server error for task ${task.id}: Status ${response.status} - ${errorText}`);
          errorCount++;
          throw new Error(`Server returned status: ${response.status}`);
        }
      } catch (fetchError) {
        console.error(`[Service Worker] Network error for task ${task.id}:`, fetchError);
        errorCount++;
        throw fetchError;
      }
    }

    console.log(`[Service Worker] Batch complete: ${successCount} success, ${conflictCount} conflicts, ${errorCount} errors`);

  } catch (error) {
    console.error(`[Service Worker] Queue processing error (Attempt ${attempt}):`, error);

    if (attempt < MAX_ATTEMPTS) {
      const backoffDelay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.log(`[Service Worker] Applying Exponential Backoff: Waiting ${backoffDelay}ms before retry ${attempt + 1}/${MAX_ATTEMPTS}`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      return processMutationQueue(attempt + 1);
    }

    console.error(`[Service Worker] Max attempts (${MAX_ATTEMPTS}) reached. Relying on browser Sync Manager for retry.`);
    return;
  }
}
// الاستماع لرسائل من العميل (مثل تأكيد حل التعارض)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FORCE_SYNC_COMPLETE') {
    console.log('[Service Worker] Force sync complete received from client');
    // يمكن هنا إرسال تحديث لجميع العملاء
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SYNC_STATUS_UPDATE',
          status: 'completed',
          message: 'تمت مزامنة البيانات بنجاح'
        });
      });
    });
  }
});

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
// Push Notifications (للاستخدام المستقبلي)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'Feed Factory';
  const options = {
    body: data.body || 'إشعار جديد',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192-maskable.png',
    vibrate: [100, 50, 100],
    data: data.url || '/'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // التحقق مما إذا كانت هناك نافذة موجودة بالفعل
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // فتح نافذة جديدة
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
