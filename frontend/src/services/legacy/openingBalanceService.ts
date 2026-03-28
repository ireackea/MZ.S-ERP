// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
import { Item, Transaction } from '../../types';

const OPENING_BALANCES_KEY = 'feed_factory_opening_balances';

export interface OpeningBalanceRecord {
  id: string;
  item_id: string;
  financial_year: number;
  period_key?: string;
  quantity: number;
}

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

export function getOpeningBalances(): OpeningBalanceRecord[] {
  const rows = readJson<OpeningBalanceRecord[]>(OPENING_BALANCES_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function getOpeningBalancesByYear(financialYear: number): OpeningBalanceRecord[] {
  return getOpeningBalances().filter((row) => row.financial_year === financialYear && !row.period_key);
}

export function upsertOpeningBalances(financialYear: number, rows: Array<{ item_id: string; quantity: number }>): OpeningBalanceRecord[] {
  const all = getOpeningBalances();
  const byUnique = new Map<string, OpeningBalanceRecord>();

  all.forEach((row) => {
    if (!row.period_key) {
      byUnique.set(`${row.item_id}-${row.financial_year}`, row);
    }
  });

  rows.forEach((row) => {
    const uniqueKey = `${row.item_id}-${financialYear}`;
    const existing = byUnique.get(uniqueKey);
    const next: OpeningBalanceRecord = {
      id: existing?.id || crypto.randomUUID(),
      item_id: row.item_id,
      financial_year: financialYear,
      quantity: Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0,
    };
    byUnique.set(uniqueKey, next);
  });

  const normalized = Array.from(byUnique.values());
  const monthlyRows = all.filter((row) => !!row.period_key);
  writeJson(OPENING_BALANCES_KEY, [...monthlyRows, ...normalized]);
  return normalized.filter((row) => row.financial_year === financialYear);
}

export function getOpeningBalancesByPeriod(periodKey: string): OpeningBalanceRecord[] {
  return getOpeningBalances().filter((row) => row.period_key === periodKey);
}

export function upsertOpeningBalancesByPeriod(periodKey: string, rows: Array<{ item_id: string; quantity: number }>): OpeningBalanceRecord[] {
  const all = getOpeningBalances();
  const byUnique = new Map<string, OpeningBalanceRecord>();

  all.forEach((row) => {
    if (row.period_key) {
      byUnique.set(`${row.item_id}-${row.period_key}`, row);
    }
  });

  rows.forEach((row) => {
    const uniqueKey = `${row.item_id}-${periodKey}`;
    const existing = byUnique.get(uniqueKey);
    const [yearStr] = periodKey.split('-');
    const financialYear = Number(yearStr) || new Date().getFullYear();
    const next: OpeningBalanceRecord = {
      id: existing?.id || crypto.randomUUID(),
      item_id: row.item_id,
      financial_year: financialYear,
      period_key: periodKey,
      quantity: Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 0,
    };
    byUnique.set(uniqueKey, next);
  });

  const monthly = Array.from(byUnique.values());
  const annualRows = all.filter((row) => !row.period_key);
  writeJson(OPENING_BALANCES_KEY, [...annualRows, ...monthly]);
  return monthly.filter((row) => row.period_key === periodKey);
}

export function getFinancialYearFromDate(input?: string | Date): number {
  if (!input) return new Date().getFullYear();
  if (typeof input === 'string') {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return new Date().getFullYear();
    return parsed.getFullYear();
  }
  return input.getFullYear();
}

function movementToSignedQuantity(tx: Transaction): number {
  if (tx.type === 'وارد' || tx.type === 'استلام') return Number(tx.quantity || 0);
  if (tx.type === 'صادر' || tx.type === 'صرف') return -Number(tx.quantity || 0);
  return 0;
}

export function getOpeningQuantity(itemId: string, financialYear: number): number {
  const row = getOpeningBalances().find((entry) => entry.item_id === itemId && entry.financial_year === financialYear);
  return row ? Number(row.quantity || 0) : 0;
}

export function getOpeningQuantityByPeriod(itemId: string, periodKey: string): number {
  const periodRow = getOpeningBalances().find((entry) => entry.item_id === itemId && entry.period_key === periodKey);
  if (periodRow) return Number(periodRow.quantity || 0);

  const [yearStr] = periodKey.split('-');
  const year = Number(yearStr);
  if (!Number.isFinite(year)) return 0;
  return getOpeningQuantity(itemId, year);
}

export function calculateCurrentBalance(params: {
  itemId: string;
  financialYear: number;
  transactions: Transaction[];
  openingQuantityOverride?: number;
}): number {
  const opening =
    typeof params.openingQuantityOverride === 'number'
      ? Number(params.openingQuantityOverride)
      : getOpeningQuantity(params.itemId, params.financialYear);

  const movement = params.transactions
    .filter((tx) => tx.itemId === params.itemId)
    .filter((tx) => getFinancialYearFromDate(tx.date) === params.financialYear)
    .reduce((sum, tx) => sum + movementToSignedQuantity(tx), 0);

  return Number((opening + movement).toFixed(3));
}

export function calculateBalancesMap(params: {
  items: Item[];
  transactions: Transaction[];
  financialYear: number;
  openingQuantities?: Map<string, number>;
}): Map<string, number> {
  const map = new Map<string, number>();
  params.items.forEach((item) => {
    map.set(
      item.id,
      calculateCurrentBalance({
        itemId: item.id,
        financialYear: params.financialYear,
        transactions: params.transactions,
        openingQuantityOverride: params.openingQuantities?.get(item.id),
      }),
    );
  });
  return map;
}
