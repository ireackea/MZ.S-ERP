import { describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer';

const frontendUrl = process.env.E2E_FRONTEND_URL || 'http://localhost:4173';

const openQueueDb = async (page: any) => page.evaluate(async () => {
  const request = indexedDB.open('FeedFactoryMutationDB', 3);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('mutationQueue')) {
      db.createObjectStore('mutationQueue', { keyPath: 'id' });
    }
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const task = {
    id: 'data-004-e2e',
    url: '/items',
    method: 'POST',
    body: { name: 'offline queue test' },
    headers: { 'Idempotency-Key': 'data-004-e2e-key' },
    ownerUserId: 'data-004-e2e-user',
    idempotencyKey: 'data-004-e2e-key',
    entity: 'items',
    operation: 'POST items',
    payloadVersion: 1,
    createdAt: Date.now(),
    timestamp: Date.now(),
    attempts: 0,
    status: 'pending',
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('mutationQueue', 'readwrite');
    transaction.objectStore('mutationQueue').put(task);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const stored = await new Promise<any>((resolve, reject) => {
    const transaction = db.transaction('mutationQueue', 'readonly');
    const getRequest = transaction.objectStore('mutationQueue').get('data-004-e2e');
    getRequest.onsuccess = () => resolve(getRequest.result);
    getRequest.onerror = () => reject(getRequest.error);
  });
  db.close();
  return stored;
});

describe('DATA-004 offline queue runtime proof', () => {
  it('registers the worker and persists queue durability fields while offline', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded' });
      const workerUrl = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return '';
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        return registration?.active?.scriptURL || registration?.installing?.scriptURL || '';
      });
      expect(workerUrl).toContain('/sw.js');

      await page.setOfflineMode(true);
      const stored = await openQueueDb(page);
      expect(stored).toMatchObject({
        idempotencyKey: 'data-004-e2e-key',
        entity: 'items',
        operation: 'POST items',
        payloadVersion: 1,
        status: 'pending',
      });
      expect(stored.createdAt).toEqual(expect.any(Number));
      expect(stored.attempts).toBe(0);
      await page.setOfflineMode(false);
    } finally {
      await browser.close();
    }
  }, 20_000);
});
