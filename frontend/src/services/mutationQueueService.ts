import apiClient from '../api/client';
import { getAuthUser } from './authSession';
import { assertStorageKeyAllowed } from './storageOwnership';

const DB_NAME = 'FeedFactoryMutationDB';
const STORE_NAME = 'mutationQueue';
const DB_VERSION = 3;
const LEASE_MS = 30_000;
export const MAX_MUTATION_ATTEMPTS = 8;
export const MUTATION_PAYLOAD_VERSION = 1;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 300_000;

type MutationStatus = 'pending' | 'processing' | 'failed' | 'conflict' | 'blocked' | 'dead-letter';

export interface MutationTask {
  id: string;
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
  ownerUserId: string;
  idempotencyKey: string;
  entity: string;
  operation: string;
  payloadVersion: number;
  createdAt: number;
  timestamp: number;
  attempts: number;
  status: MutationStatus;
  leaseUntil?: number;
  nextRetryAt?: number;
  lastError?: string;
}

export type QueueStats = {
  pending: number;
  processing: number;
  failed: number;
  conflicts: number;
  blocked: number;
  deadLetter: number;
  total: number;
};

const inferEntity = (url: string) => {
  const path = String(url || '').split('?')[0];
  const segment = path.split('/').filter(Boolean)[0] || 'unknown';
  return segment.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown';
};

const inferOperation = (url: string, method: string) => `${String(method || 'POST').toUpperCase()} ${inferEntity(url)}`;

const normalizeTask = (value: any): MutationTask => {
  const now = Date.now();
  const createdAt = Number(value?.createdAt ?? value?.timestamp) || now;
  const validStatuses: MutationStatus[] = ['pending', 'processing', 'failed', 'conflict', 'blocked', 'dead-letter'];
  const status = validStatuses.includes(value?.status) ? value.status : 'pending';
  return {
    ...value,
    id: String(value?.id || crypto.randomUUID()),
    url: String(value?.url || ''),
    method: String(value?.method || 'POST'),
    body: value?.body,
    headers: value?.headers && typeof value.headers === 'object' ? value.headers : {},
    ownerUserId: String(value?.ownerUserId || ''),
    idempotencyKey: String(value?.idempotencyKey || value?.headers?.['Idempotency-Key'] || crypto.randomUUID()),
    entity: String(value?.entity || inferEntity(value?.url)),
    operation: String(value?.operation || inferOperation(value?.url, value?.method)),
    payloadVersion: Number.isInteger(value?.payloadVersion) ? value.payloadVersion : MUTATION_PAYLOAD_VERSION,
    createdAt,
    timestamp: Number(value?.timestamp) || createdAt,
    attempts: Number.isInteger(value?.attempts) && value.attempts >= 0 ? value.attempts : 0,
    status,
  };
};

export const calculateRetryDelay = (attempts: number) =>
  Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(Math.max(attempts - 1, 0), 8));

export const shouldDeadLetter = (attempts: number) => attempts >= MAX_MUTATION_ATTEMPTS;

const summarize = (queue: MutationTask[]): QueueStats => ({
  pending: queue.filter((task) => task.status === 'pending').length,
  processing: queue.filter((task) => task.status === 'processing').length,
  failed: queue.filter((task) => task.status === 'failed').length,
  conflicts: queue.filter((task) => task.status === 'conflict').length,
  blocked: queue.filter((task) => task.status === 'blocked').length,
  deadLetter: queue.filter((task) => task.status === 'dead-letter').length,
  total: queue.length,
});

export type SyncSummary = {
  succeeded: number;
  failed: number;
  conflicts: number;
  blocked: number;
  deadLetter: number;
  pending: number;
};

const getOwnerId = (explicitOwnerId?: string) => String(explicitOwnerId || getAuthUser()?.id || '').trim();
const isSafeMutationUrl = (url: string) => url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/auth/');

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  assertStorageKeyAllowed(DB_NAME, 'indexedDB');
  assertStorageKeyAllowed(STORE_NAME, 'indexedDB');
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
  request.onupgradeneeded = (event) => {
    const db = (event.target as IDBOpenDBRequest).result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
});

const readAll = (db: IDBDatabase) => new Promise<MutationTask[]>((resolve, reject) => {
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).getAll();
  request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result.map(normalizeTask) : []);
  request.onerror = () => reject(request.error);
});

const writeTask = (db: IDBDatabase, task: MutationTask) => new Promise<void>((resolve, reject) => {
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const request = transaction.objectStore(STORE_NAME).put(task);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});

const deleteTask = (db: IDBDatabase, id: string) => new Promise<void>((resolve, reject) => {
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const request = transaction.objectStore(STORE_NAME).delete(id);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});

export const mutationQueueService = {
  dbPromise: null as Promise<IDBDatabase> | null,

  init() {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      this.dbPromise = null;
      return;
    }
    if (!this.dbPromise) this.dbPromise = openDatabase();
  },

  async enqueue(url: string, method: string, body: any, headers: Record<string, string> = {}) {
    if (!isSafeMutationUrl(url)) throw new Error('MUTATION_URL_NOT_ALLOWED');
    const ownerUserId = getOwnerId();
    if (!ownerUserId) throw new Error('AUTHENTICATED_USER_REQUIRED');

    this.init();
    if (!this.dbPromise) throw new Error('MUTATION_QUEUE_UNAVAILABLE');
    const db = await this.dbPromise;
    const idempotencyKey = String(headers['Idempotency-Key'] || headers['idempotency-key'] || crypto.randomUUID());
    const createdAt = Date.now();
    const task: MutationTask = {
      id: crypto.randomUUID(),
      url,
      method,
      body,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      ownerUserId,
      idempotencyKey,
      entity: inferEntity(url),
      operation: inferOperation(url, method),
      payloadVersion: MUTATION_PAYLOAD_VERSION,
      createdAt,
      timestamp: createdAt,
      attempts: 0,
      status: 'pending',
    };

    try {
      await writeTask(db, task);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message || ''))) {
        throw new Error('MUTATION_QUEUE_QUOTA_EXCEEDED');
      }
      throw error;
    }
  },

  async getQueue(ownerUserId = getOwnerId()): Promise<MutationTask[]> {
    if (!ownerUserId || typeof indexedDB === 'undefined') return [];
    this.init();
    if (!this.dbPromise) return [];
    const db = await this.dbPromise;
    const queue = await readAll(db);
    return queue
      .filter((task) => task.ownerUserId === ownerUserId)
      .sort((left, right) => left.createdAt - right.createdAt);
  },

  async claimNext(ownerUserId = getOwnerId()): Promise<MutationTask | null> {
    if (!ownerUserId) return null;
    this.init();
    if (!this.dbPromise) return null;
    const db = await this.dbPromise;
    const now = Date.now();
    const queue = await this.getQueue(ownerUserId);
    const task = queue.find((entry) => {
      if (entry.status === 'conflict' || entry.status === 'blocked' || entry.status === 'dead-letter') return false;
      if (entry.nextRetryAt && entry.nextRetryAt > now) return false;
      if (entry.leaseUntil && entry.leaseUntil > now) return false;
      return true;
    });
    if (!task) return null;
    if (task.payloadVersion !== MUTATION_PAYLOAD_VERSION) {
      await writeTask(db, {
        ...task,
        status: 'dead-letter',
        leaseUntil: undefined,
        nextRetryAt: undefined,
        lastError: 'UNSUPPORTED_PAYLOAD_VERSION',
      });
      return null;
    }
    const claimed: MutationTask = {
      ...task,
      status: 'processing',
      attempts: task.attempts + 1,
      leaseUntil: now + LEASE_MS,
      lastError: undefined,
    };
    await writeTask(db, claimed);
    return claimed;
  },

  async markTask(task: MutationTask, error: any) {
    this.init();
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    const statusCode = Number(error?.response?.status || 0);
    const baseStatus: MutationStatus = statusCode === 409
      ? 'conflict'
      : statusCode === 401 || statusCode === 403
        ? 'blocked'
        : 'failed';
    const status: MutationStatus = baseStatus === 'failed' && shouldDeadLetter(task.attempts)
      ? 'dead-letter'
      : baseStatus;
    await writeTask(db, {
      ...task,
      status,
      leaseUntil: undefined,
      nextRetryAt: status === 'failed' ? Date.now() + calculateRetryDelay(task.attempts) : undefined,
      lastError: String(error?.response?.data?.message || error?.message || 'Mutation failed').slice(0, 500),
    });
  },

  async clearTask(id: string) {
    this.init();
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    await deleteTask(db, id);
  },

  async getQueueSize(ownerUserId = getOwnerId()) {
    return (await this.getQueue(ownerUserId)).length;
  },

  async getQueueStats(ownerUserId = getOwnerId()): Promise<QueueStats> {
    return summarize(await this.getQueue(ownerUserId));
  },

  async retryTask(id: string) {
    this.init();
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    const task = (await readAll(db)).find((entry) => entry.id === id);
    if (!task) return;
    await writeTask(db, {
      ...task,
      status: 'pending',
      attempts: 0,
      leaseUntil: undefined,
      nextRetryAt: undefined,
      lastError: undefined,
    });
  },

  /**
   * Gate 4.7 - retry what failed, not what was refused.
   *
   * `blocked` means the server answered 401 or 403: the account was deactivated,
   * locked, or its role was narrowed. Those are not transient failures and
   * re-sending them cannot succeed. This used to flip `blocked` back to pending
   * along with everything else, so the settings "retry all" button produced a fresh
   * refusal every time it was pressed and the counters never reached zero.
   *
   * Dead-lettered tasks are still retried: that state means the payload itself was
   * rejected repeatedly, and an operator who has fixed the data may want another go.
   */
  async retryOwner(ownerUserId = getOwnerId()) {
    this.init();
    if (!this.dbPromise || !ownerUserId) return;
    const db = await this.dbPromise;
    const queue = await readAll(db);
    await Promise.all(queue
      .filter((task) => task.ownerUserId === ownerUserId && ['failed', 'conflict', 'dead-letter'].includes(task.status))
      .map((task) => writeTask(db, {
        ...task,
        status: 'pending',
        attempts: 0,
        leaseUntil: undefined,
        nextRetryAt: undefined,
        lastError: undefined,
      })));
  },

  /**
   * Gate 4.7 - resuming on login must not resurrect what the server refused.
   *
   * This ran on every successful login, so a `blocked` task from a previous
   * session was re-sent the moment the user returned. Blocked tasks now stay
   * blocked; they are not lost, they keep their `lastError` and remain visible in
   * settings, and an operator who has genuinely been re-granted the permission can
   * clear them deliberately.
   */
  async resumeOwner(ownerUserId: string) {
    this.init();
    if (!this.dbPromise || !ownerUserId) return;
    const db = await this.dbPromise;
    const queue = await readAll(db);
    await Promise.all(queue
      // Gate 4.7: nothing is resumed. The previous predicate put `blocked` tasks back
    // to pending on every login, which is a 401/403 loop with no exit. Kept as an
    // explicit filter rather than an early return so the intent is legible.
    .filter(() => false)
      .map((task) => writeTask(db, {
        ...task,
        status: 'pending',
        leaseUntil: undefined,
        nextRetryAt: undefined,
      })));
  },

  async sync(ownerUserId = getOwnerId()): Promise<SyncSummary> {
    const summary: SyncSummary = { succeeded: 0, failed: 0, conflicts: 0, blocked: 0, deadLetter: 0, pending: 0 };
    if (!ownerUserId) return summary;

    for (;;) {
      const task = await this.claimNext(ownerUserId);
      if (!task) break;
      try {
        await apiClient.request({ url: task.url, method: task.method, data: task.body, headers: task.headers });
        await this.clearTask(task.id);
        summary.succeeded += 1;
      } catch (error: any) {
        await this.markTask(task, error);
        const statusCode = Number(error?.response?.status || 0);
        if (statusCode === 409) summary.conflicts += 1;
        else if (statusCode === 401 || statusCode === 403) summary.blocked += 1;
        else if (shouldDeadLetter(task.attempts)) summary.deadLetter += 1;
        else summary.failed += 1;
      }
    }

    summary.pending = (await this.getQueue(ownerUserId)).length;
    return summary;
  },

  async quarantineOwner(ownerUserId: string) {
    if (!ownerUserId) return;
    this.init();
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    const queue = await readAll(db);
    await Promise.all(queue
      .filter((task) => task.ownerUserId === ownerUserId)
      .map((task) => writeTask(db, {
        ...task,
        status: 'blocked',
        leaseUntil: undefined,
        lastError: 'AUTH_SESSION_CHANGED',
      })));
  },
};

mutationQueueService.init();
