
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';

(globalThis as any).expect = expect;

// Mock IndexedDB for test environments that do not provide it (e.g. jsdom)
if (typeof globalThis.indexedDB === 'undefined') {
  const stores: Record<string, Record<string, any>> = {};

  const createRequest = (result: any = undefined, error: any = null) => {
    const req: any = { result, error, onsuccess: null, onerror: null, onupgradeneeded: null };
    Promise.resolve().then(() => {
      if (error && req.onerror) req.onerror({ target: req });
      else if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  };

  const mockDb = (name: string) => ({
    objectStoreNames: { contains: () => false },
    createObjectStore: (storeName: string) => {
      stores[`${name}/${storeName}`] = {};
      return { createIndex: () => {} };
    },
    transaction: (storeNames: string | string[], _mode?: string) => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const tx: any = { oncomplete: null, onerror: null };
      tx.objectStore = (storeName: string) => ({
        put: (value: any) => { stores[`${name}/${storeName}`][value?.id ?? Date.now()] = value; return createRequest(value); },
        get: (key: any) => createRequest(stores[`${name}/${storeName}`]?.[key]),
        getAll: () => createRequest(Object.values(stores[`${name}/${storeName}`] ?? {})),
        delete: (key: any) => { delete stores[`${name}/${storeName}`]?.[key]; return createRequest(); },
        clear: () => { stores[`${name}/${storeName}`] = {}; return createRequest(); },
        openCursor: () => createRequest(null),
      });
      Promise.resolve().then(() => { if (tx.oncomplete) tx.oncomplete(); });
      return tx;
    },
    close: () => {},
  });

  (globalThis as any).indexedDB = {
    open: (name: string, _version?: number) => {
      const req: any = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      Promise.resolve().then(() => {
        const db = mockDb(name);
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: 0 });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    deleteDatabase: (_name: string) => createRequest(),
  };
}
