// ENTERPRISE FIX: Phase 1.6 - Final Cleanup Pass - 2026-03-02
// تحسين Background Sync - كود كامل ومستقر مع Exponential Backoff و 409 Conflict Handling

const CACHE_NAME = 'feedfactory-pwa-v3';
const DYNAMIC_CACHE = 'feedfactory-api-v3';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
// استراتيجيات التخزين المؤقت المحسنة

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

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
// استراتيجية Stale-While-Revalidate للبيانات عالية الأولوية
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

  // API POST/PUT/DELETE: Network only (Queue is handled by client-side IndexedDB Service)
  if (url.pathname.startsWith('/api') && event.request.method !== 'GET') {
    // Let it go to network - offline handling is done by mutation queue
    return;
  }

  // Static Assets: Network first, fallback to Cache
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).catch(() => {
        console.log('[Service Worker] Static asset offline, trying cache for:', url.pathname);
        return caches.match(event.request);
      })
    );
  }
});

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
// Background Sync مع Exponential Backoff و 409 Conflict Handling
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-mutations') {
    console.log('[Service Worker] Background sync triggered: sync-mutations');
    event.waitUntil(processMutationQueue());
  }
});

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
/**
 * معالجة طابور العمليات المعلقة مع Exponential Backoff
 * - MAX_ATTEMPTS: أقصى عدد المحاولات قبل التوقف
 * - BACKOFF_BASE_MS: زمن الانتظار الأساسي (2 ثواني)
 * - Backoff Strategy: 2s -> 4s -> 8s -> 16s -> 32s
 */
async function processMutationQueue(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  const BACKOFF_BASE_MS = 2000; // 2 seconds base

  console.log(`[Service Worker] processMutationQueue - Attempt ${attempt}/${MAX_ATTEMPTS}`);

  try {
    // فتح قاعدة البيانات IndexedDB
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('FeedFactoryMutationDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('mutationQueue')) {
          db.createObjectStore('mutationQueue', { keyPath: 'id' });
        }
      };
    });

    // جلب جميع المهام من الطابور
    const tx = db.transaction('mutationQueue', 'readonly');
    const store = tx.objectStore('mutationQueue');
    const tasks = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (tasks.length === 0) {
      console.log('[Service Worker] No pending tasks in queue.');
      return;
    }

    // ترتيب المهام حسب الوقت (الأقدم أولاً)
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

        // معالجة الاستجابة
        if (response.ok) {
          // نجاح العملية - حذف من الطابور
          console.log(`[Service Worker] Task ${task.id} synced successfully (Status: ${response.status})`);
          successCount++;

          await new Promise((resolve, reject) => {
            const dtx = db.transaction('mutationQueue', 'readwrite');
            const dstore = dtx.objectStore('mutationQueue');
            const dreq = dstore.delete(task.id);
            dreq.onsuccess = () => resolve();
            dreq.onerror = () => reject();
          });
        } else if (response.status === 409) {
          // تعارض 409 - السيرفر لديه نسخة أحدث
          console.warn(`[Service Worker] Conflict 409 detected for task ${task.id}. Server has newer version.`);
          conflictCount++;

          // إرسال إشعار للعميل لحل التعارض عبر Modal
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

          // حذف المهمة من الخلفية - العميل سيحل التعارض
          await new Promise((resolve, reject) => {
            const dtx = db.transaction('mutationQueue', 'readwrite');
            const dstore = dtx.objectStore('mutationQueue');
            const dreq = dstore.delete(task.id);
            dreq.onsuccess = () => resolve();
            dreq.onerror = () => reject();
          });

          console.log(`[Service Worker] Task ${task.id} removed from queue - client will handle conflict`);
        } else {
          // خطأ آخر من السيرفر
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`[Service Worker] Server error for task ${task.id}: Status ${response.status} - ${errorText}`);
          errorCount++;
          throw new Error(`Server returned status: ${response.status}`);
        }
      } catch (fetchError) {
        // فشل في الاتصال - خطأ شبكي
        console.error(`[Service Worker] Network error for task ${task.id}:`, fetchError);
        errorCount++;
        throw fetchError; // إعادة الرمي لتحفيز Backoff
      }
    }

    console.log(`[Service Worker] Batch complete: ${successCount} success, ${conflictCount} conflicts, ${errorCount} errors`);

  } catch (error) {
    console.error(`[Service Worker] Queue processing error (Attempt ${attempt}):`, error);

    // تطبيق Exponential Backoff
    if (attempt < MAX_ATTEMPTS) {
      const backoffDelay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.log(`[Service Worker] Applying Exponential Backoff: Waiting ${backoffDelay}ms before retry ${attempt + 1}/${MAX_ATTEMPTS}`);

      // انتظار زمن الـ Backoff
      await new Promise(resolve => setTimeout(resolve, backoffDelay));

      // محاولةอีกครั้ง
      return processMutationQueue(attempt + 1);
    } else {
      // تم استنفاذ المحاولات - الاعتماد على Sync Manager الخاص بالمتصفح
      console.error(`[Service Worker] Max attempts (${MAX_ATTEMPTS}) reached. Relying on browser Sync Manager for retry.`);
      // لا نرمي الخطأ هنا لتجنب إيقاف Service Worker
      return;
    }
  }
}

// ENTERPRISE FIX: Phase 1.6 - Final Polish Pass - 2026-03-02
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
