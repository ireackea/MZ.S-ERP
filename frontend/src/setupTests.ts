import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-registers cleanup when the test globals are enabled.
// This project runs with `globals: false`, so without this renders leak between
// tests in the same file and later assertions can see earlier DOM.
afterEach(() => {
  cleanup();
});

type StorageKind = 'localStorage' | 'sessionStorage';

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(String(key)) ? values.get(String(key))! : null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  } as Storage;
};

const ensureStorage = (kind: StorageKind) => {
  if (typeof window === 'undefined') return;
  try {
    if (window[kind]) return;
  } catch {
    // Fall through to the isolated test storage below.
  }
  Object.defineProperty(window, kind, {
    configurable: true,
    value: createMemoryStorage(),
    writable: false,
  });
};

ensureStorage('localStorage');
ensureStorage('sessionStorage');
