import { Item, OperationType, Transaction } from '../types';
import { getOpeningQuantityByPeriod, upsertOpeningBalancesByPeriod } from './openingBalanceService';

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
  totalProduction: number;
  totalOutbound: number;
  totalWaste: number;
  theoreticalBalance: number;
  actualCount?: number;
  difference?: number;
  notes?: string;
}

const STOCKTAKING_SESSIONS_KEY = 'feed_factory_monthly_stocktaking_sessions';

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readSessions(): MonthlyStocktakingSession[] {
  const rows = readJson<MonthlyStocktakingSession[]>(STOCKTAKING_SESSIONS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function writeSessions(rows: MonthlyStocktakingSession[]) {
  writeJson(STOCKTAKING_SESSIONS_KEY, rows);
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
  const sessions = readSessions();
  const existing = sessions.find((row) => row.monthKey === monthKey);
  if (existing) return existing;
  const created: MonthlyStocktakingSession = {
    monthKey,
    itemRecords: {},
    closed: false,
  };
  sessions.push(created);
  writeSessions(sessions);
  return created;
}

export function saveMonthlySession(session: MonthlyStocktakingSession): MonthlyStocktakingSession {
  const sessions = readSessions();
  const idx = sessions.findIndex((row) => row.monthKey === session.monthKey);
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  writeSessions(sessions);
  return session;
}

export function upsertItemCount(params: {
  monthKey: string;
  itemId: string;
  userName: string;
  value: number;
  notes?: string;
}): MonthlyStocktakingSession {
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

  return saveMonthlySession(session);
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
}): MonthlyAuditRow[] {
  const { start, end } = getMonthBounds(params.monthKey);
  const session = getOrCreateMonthlySession(params.monthKey);

  return params.items.map((item) => {
    const openingBalance = getOpeningQuantityByPeriod(item.id, params.monthKey);

    const itemTransactions = params.transactions.filter((tx) => {
      if (tx.itemId !== item.id) return false;
      const txDate = new Date(tx.date);
      if (Number.isNaN(txDate.getTime())) return false;
      return txDate >= start && txDate <= end;
    });

    const totalByType = (operationType: OperationType) => itemTransactions
      .filter((tx) => tx.type === operationType)
      .reduce((sum, tx) => sum + Number(tx.quantity || 0), 0);

    const totalInbound = totalByType('وارد');
    const totalProduction = totalByType('إنتاج');
    const totalOutbound = totalByType('صادر');
    const totalWaste = totalByType('هالك');

    const theoreticalBalance = openingBalance + totalInbound + totalProduction - totalOutbound - totalWaste;
    const itemRecord = session.itemRecords[item.id];
    const actualCount = itemRecord?.actualCount;
    const difference = actualCount === undefined ? undefined : Number((theoreticalBalance - actualCount).toFixed(3));

    return {
      itemId: item.id,
      itemName: item.name,
      openingBalance: Number(openingBalance.toFixed(3)),
      totalInbound: Number(totalInbound.toFixed(3)),
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

export function closeMonth(params: {
  monthKey: string;
  approvedBy: string;
  rows: MonthlyAuditRow[];
  archivedPdfName: string;
  archivedPdfMime: string;
  archivedPdfData: string;
}): { ok: boolean; reason?: string; session: MonthlyStocktakingSession } {
  const session = getOrCreateMonthlySession(params.monthKey);
  if (session.closed) {
    return { ok: false, reason: 'تم إغلاق هذا الشهر مسبقاً.', session };
  }

  const hasConflicts = Object.values(session.itemRecords).some((record) => isItemConflicted(record));
  if (hasConflicts) {
    return { ok: false, reason: 'يوجد أصناف متضاربة، يجب حلها قبل الإغلاق.', session };
  }

  const nextMonthKey = getNextMonthKey(params.monthKey);
  upsertOpeningBalancesByPeriod(
    nextMonthKey,
    params.rows.map((row) => ({ item_id: row.itemId, quantity: row.theoreticalBalance }))
  );

  session.closed = true;
  session.closedAt = Date.now();
  session.closedBy = params.approvedBy;
  session.archivedPdfName = params.archivedPdfName;
  session.archivedPdfMime = params.archivedPdfMime;
  session.archivedPdfData = params.archivedPdfData;

  const saved = saveMonthlySession(session);
  return { ok: true, session: saved };
}
