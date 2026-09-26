import { assertStorageKeyAllowed } from '../services/storageOwnership';

type BootstrapOutcome = 'success' | 'failed' | 'anonymous';

export type BootstrapMetricsSnapshot = {
  id: string;
  reason: string;
  routePath: string;
  startedAt: number;
  completedAt: number | null;
  bootstrap_duration_ms: number | null;
  bootstrap_request_count: number;
  renderCommitCount: number;
  renderActualDurationMs: number;
  renderBaseDurationMs: number;
  outcome: BootstrapOutcome;
  lastError: string | null;
  requests: Array<{ method: string; url: string; at: number }>;
};

type WindowWithBootstrapMetrics = Window & {
  __MZ_BOOTSTRAP_METRICS__?: {
    active: BootstrapMetricsSnapshot | null;
    last: BootstrapMetricsSnapshot | null;
  };
};

const ENABLED = import.meta.env.DEV;
const STORAGE_KEY = 'feed_factory_bootstrap_metrics:last';

let activeSnapshot: BootstrapMetricsSnapshot | null = null;
let lastSnapshot: BootstrapMetricsSnapshot | null = null;

const createBootstrapId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bootstrap-${Date.now()}`;
};

const publishSnapshots = () => {
  if (typeof window === 'undefined') return;

  const bootstrapWindow = window as WindowWithBootstrapMetrics;
  bootstrapWindow.__MZ_BOOTSTRAP_METRICS__ = {
    active: activeSnapshot,
    last: lastSnapshot,
  };

  if (lastSnapshot?.completedAt) {
    assertStorageKeyAllowed(STORAGE_KEY, 'sessionStorage');
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lastSnapshot));
  }
};

export const startBootstrapMetrics = (reason: string, routePath: string) => {
  if (!ENABLED) return null;
  if (activeSnapshot) return activeSnapshot.id;

  activeSnapshot = {
    id: createBootstrapId(),
    reason,
    routePath,
    startedAt: Date.now(),
    completedAt: null,
    bootstrap_duration_ms: null,
    bootstrap_request_count: 0,
    renderCommitCount: 0,
    renderActualDurationMs: 0,
    renderBaseDurationMs: 0,
    outcome: 'success',
    lastError: null,
    requests: [],
  };
  lastSnapshot = activeSnapshot;
  publishSnapshots();
  return activeSnapshot.id;
};

export const isBootstrapMetricsActive = () => ENABLED && activeSnapshot !== null;

export const markBootstrapRequest = (method: string, url: string) => {
  if (!ENABLED || !activeSnapshot) return;

  activeSnapshot.bootstrap_request_count += 1;
  if (activeSnapshot.requests.length < 25) {
    activeSnapshot.requests.push({
      method,
      url,
      at: Date.now(),
    });
  }
  publishSnapshots();
};

export const recordBootstrapRenderCommit = (actualDuration: number, baseDuration: number) => {
  if (!ENABLED) return;

  const target = activeSnapshot ?? lastSnapshot;
  if (!target) return;

  target.renderCommitCount += 1;
  target.renderActualDurationMs = Number((target.renderActualDurationMs + actualDuration).toFixed(2));
  target.renderBaseDurationMs = Number((target.renderBaseDurationMs + baseDuration).toFixed(2));
  publishSnapshots();
};

export const completeBootstrapMetrics = (options?: { outcome?: BootstrapOutcome; error?: string | null }) => {
  if (!ENABLED || !activeSnapshot) return null;

  const completedAt = Date.now();
  const snapshot: BootstrapMetricsSnapshot = {
    ...activeSnapshot,
    completedAt,
    bootstrap_duration_ms: completedAt - activeSnapshot.startedAt,
    outcome: options?.outcome ?? 'success',
    lastError: options?.error ?? null,
  };

  activeSnapshot = null;
  lastSnapshot = snapshot;
  publishSnapshots();

  console.info('[bootstrap metrics]', snapshot);
  return snapshot;
};