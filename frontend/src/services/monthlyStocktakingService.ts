import { Item, OperationType, Transaction } from '../types';
import { canonicalizeOperationType } from '../utils/operationTypes';
import { stocktakingApi, type StocktakingApiSession } from './stocktakingApi';

export interface StocktakingCountEntry {
  userName: string;
  value: number;
  at: number;
}

export interface StocktakingItemRecord {
  itemId: string;
  actualCount?: number;
  notes?: string;
  entries: StocktakingCountEntry[];
}

export interface MonthlyStocktakingSession {
  monthKey: string;
  itemRecords: Record<string, StocktakingItemRecord>;
  closed: boolean;
  closedAt?: number;
  closedBy?: string;
  archivedPdfName?: string;
  archivedPdfData?: string;
  archivedPdfMime?: string;
  manualSignedPdfName?: string;
  manualSignedPdfData?: string;
  manualSignedPdfMime?: string;
}

export interface MonthlyAuditRow {
  itemId: string;
  itemName: string;
  openingBalance: number;
  totalInbound: number;
  totalReturns: number;
  totalProduction: number;
  totalOutbound: number;
  totalWaste: number;
  theoreticalBalance: number;
  actualCount?: number;
  difference?: number;
  notes?: string;
}

const sessionCache = new Map<string, MonthlyStocktakingSession>();
const sessionIds = new Map<string, string>();
const entryIds = new Map<string, string>();

const fromApiSession = (session: StocktakingApiSession): MonthlyStocktakingSession => {
  session.entries.forEach((entry) => entryIds.set(`${session.id}:${entry.itemId}`, entry.id));
  return {
  monthKey: session.monthKey,
  itemRecords: Object.fromEntries(session.entries.map((entry) => [entry.itemId, {
    itemId: entry.itemId,
    actualCount: entry.actualCount,
    notes: entry.notes,
    entries: entry.counts.map((count) => ({
      userName: String(count.userId || 'unknown'),
      value: count.value,
      at: new Date(count.at).getTime(),
    })),
  }])),
  closed: session.closed,
  closedAt: session.closedAt ? new Date(session.closedAt).getTime() : undefined,
  closedBy: session.closedById,
  archivedPdfName: session.archivedPdfName,
  archivedPdfMime: session.archivedPdfMime,
  archivedPdfData: session.archivedPdfData,
  };
};

const toApiSession = (session: StocktakingApiSession) => session;

export async function loadMonthlySession(monthKey: string, warehouseId = 'default'): Promise<MonthlyStocktakingSession> {
  const remote = await stocktakingApi.get(monthKey, warehouseId) || await stocktakingApi.create(monthKey, warehouseId);
  const normalized = fromApiSession(toApiSession(remote));
  sessionIds.set(monthKey, remote.id);
  sessionCache.set(monthKey, normalized);
  return normalized;
}

export function getMonthBounds(monthKey: string): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : (new Date().getMonth() + 1);
  const start = new Date(safeYear, safeMonth - 1, 1, 0, 0, 0, 0);
  const end = new Date(safeYear, safeMonth, 0, 23, 59, 59, 999);
  return { start, end };
}

export function getNextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const base = new Date(Number.isFinite(year) ? year : new Date().getFullYear(), (Number.isFinite(month) ? month : 1) - 1, 1);
  base.setMonth(base.getMonth() + 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Number.isFinite(year) ? year : new Date().getFullYear(), (Number.isFinite(month) ? month : 1) - 1, 1);
  const monthName = date.toLocaleDateString('en-US', { month: 'long' });
  return `${monthName}_${date.getFullYear()}`;
}

export function getOrCreateMonthlySession(monthKey: string): MonthlyStocktakingSession {
  const existing = sessionCache.get(monthKey);
  if (existing) return existing;
  const created: MonthlyStocktakingSession = {
    monthKey,
    itemRecords: {},
    closed: false,
  };
  sessionCache.set(monthKey, created);
  return created;
}

export function saveMonthlySession(session: MonthlyStocktakingSession): MonthlyStocktakingSession {
  sessionCache.set(session.monthKey, session);
  return session;
}

export async function upsertItemCount(params: {
  monthKey: string;
  itemId: string;
  userName: string;
  value: number;
  notes?: string;
  resolveConflict?: boolean;
}): Promise<MonthlyStocktakingSession> {
  const session = getOrCreateMonthlySession(params.monthKey);
  if (session.closed) return session;

  const current = session.itemRecords[params.itemId] || {
    itemId: params.itemId,
    entries: [],
  };

  const nextEntries = [...current.entries.filter((entry) => entry.userName !== params.userName), {
    userName: params.userName,
    value: Number(params.value),
    at: Date.now(),
  }];

  session.itemRecords[params.itemId] = {
    ...current,
    notes: params.notes ?? current.notes,
    entries: nextEntries,
    actualCount: Number(params.value),
  };

  const saved = saveMonthlySession(session);
  const remoteId = sessionIds.get(params.monthKey);
  if (!remoteId) return saved;
  const persisted = params.resolveConflict && entryIds.get(`${remoteId}:${params.itemId}`)
    ? await stocktakingApi.resolveEntry(remoteId, entryIds.get(`${remoteId}:${params.itemId}`)!, {
      itemId: params.itemId,
      actualCount: Number(params.value),
      notes: params.notes,
    })
    : await stocktakingApi.upsertEntry(remoteId, {
      itemId: params.itemId,
      actualCount: Number(params.value),
      notes: params.notes,
    });
  const normalized = fromApiSession(persisted);
  sessionCache.set(params.monthKey, normalized);
  return normalized;
}

export function saveManualSignedPdf(monthKey: string, fileName: string, mime: string, base64Data: string): MonthlyStocktakingSession {
  const session = getOrCreateMonthlySession(monthKey);
  session.manualSignedPdfName = fileName;
  session.manualSignedPdfMime = mime;
  session.manualSignedPdfData = base64Data;
  return saveMonthlySession(session);
}

export function isItemConflicted(record?: StocktakingItemRecord): boolean {
  if (!record || record.entries.length <= 1) return false;
  const uniqueValues = new Set(record.entries.map((entry) => Number(entry.value.toFixed(3))));
  return uniqueValues.size > 1;
}

export function computeMonthlyAuditRows(params: {
  monthKey: string;
  items: Item[];
  transactions: Transaction[];
  openingBalances?: Record<string, number>;
}): MonthlyAuditRow[] {
  const { start, end } = getMonthBounds(params.monthKey);
  const session = getOrCreateMonthlySession(params.monthKey);

  return params.items.map((item) => {
    const openingBalance = params.openingBalances?.[item.id] ?? 0;

    const itemTransactions = params.transactions.filter((tx) => {
      if (tx.itemId !== item.id) return false;
      const txDate = new Date(tx.date);
      if (Number.isNaN(txDate.getTime())) return false;
      return txDate >= start && txDate <= end;
    });

    const totalByType = (operationType: OperationType) => itemTransactions
      .filter((tx) => canonicalizeOperationType(tx.type) === operationType)
      .reduce((sum, tx) => sum + Number(tx.quantity || 0), 0);

    const totalInbound = totalByType('وارد');
    const totalReturns = totalByType('مرتجع');
    const totalProduction = totalByType('انتاج');
    const totalOutbound = totalByType('صادر');
    const totalWaste = totalByType('هالك');

    const theoreticalBalance = openingBalance + totalInbound + totalReturns + totalProduction - totalOutbound - totalWaste;
    const itemRecord = session.itemRecords[item.id];
    const actualCount = itemRecord?.actualCount;
    const difference = actualCount === undefined ? undefined : Number((theoreticalBalance - actualCount).toFixed(3));

    return {
      itemId: item.id,
      itemName: item.name,
      openingBalance: Number(openingBalance.toFixed(3)),
      totalInbound: Number(totalInbound.toFixed(3)),
      totalReturns: Number(totalReturns.toFixed(3)),
      totalProduction: Number(totalProduction.toFixed(3)),
      totalOutbound: Number(totalOutbound.toFixed(3)),
      totalWaste: Number(totalWaste.toFixed(3)),
      theoreticalBalance: Number(theoreticalBalance.toFixed(3)),
      actualCount: actualCount === undefined ? undefined : Number(actualCount.toFixed(3)),
      difference,
      notes: itemRecord?.notes,
    };
  });
}

export async function closeMonth(params: {
  monthKey: string;
  approvedBy: string;
  rows: MonthlyAuditRow[];
  archivedPdfName: string;
  archivedPdfMime: string;
  archivedPdfData: string;
}): Promise<{ ok: boolean; reason?: string; session: MonthlyStocktakingSession }> {
  const session = getOrCreateMonthlySession(params.monthKey);
  if (session.closed) {
    return { ok: false, reason: 'تم إغلاق هذا الشهر مسبقاً.', session };
  }

  const hasConflicts = Object.values(session.itemRecords).some((record) => isItemConflicted(record));
  if (hasConflicts) {
    return { ok: false, reason: 'يوجد أصناف متضاربة، يجب حلها قبل الإغلاق.', session };
  }

  const remoteId = sessionIds.get(params.monthKey);
  if (!remoteId) {
    return { ok: false, reason: 'جلسة الجرد غير محفوظة على الخادم.', session };
  }

  try {
    const closed = await stocktakingApi.close(remoteId, {
      archivedPdfName: params.archivedPdfName,
      archivedPdfMime: params.archivedPdfMime,
      archivedPdfData: params.archivedPdfData,
    });
    const normalized = fromApiSession(closed);
    sessionCache.set(params.monthKey, normalized);
    return { ok: true, session: normalized };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'فشل إغلاق الجرد.', session };
  }
}
