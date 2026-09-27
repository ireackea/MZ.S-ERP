import apiClient from '../api/client';
import type { DecimalValue } from '../types';

/**
 * FC-DEF-001 — the client for the stock deficit queue.
 *
 * A deficit is a recorded shortfall, so every field here is a decimal string on
 * the wire and a DecimalValue locally. The screen must not assume a number: the
 * whole reason the queue exists is that the balance is clamped, so a shortfall
 * is a real quantity that has to survive a round trip exactly.
 */
export type StockDeficitStatus =
  | 'OPEN'
  | 'SETTLED_BY_RECEIPT'
  | 'SETTLED_BY_CORRECTION'
  | 'WRITTEN_OFF';

export type StockDeficitRow = {
  id: number;
  publicId: string;
  itemId: string;
  itemName: string;
  itemCode?: string | null;
  unit?: string | null;
  warehouseId: string;
  /** Always positive: the magnitude the movement could not cover. */
  quantity: DecimalValue;
  status: StockDeficitStatus;
  sourceTransactionId?: string | null;
  settledByTransactionId?: string | null;
  reason?: string | null;
  resolution?: string | null;
  createdById?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedById?: string | null;
};

export type StockDeficitListResponse = {
  data: StockDeficitRow[];
  total: number;
  limit: number;
  offset: number;
  openCount: number;
  openQuantity: DecimalValue;
};

const unwrap = <T>(payload: any): T => (payload?.data ?? payload) as T;

export const stockDeficitApi = {
  async list(options: { status?: string; itemId?: string; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.itemId) params.set('itemId', options.itemId);
    params.set('limit', String(options.limit ?? 50));
    params.set('offset', String(options.offset ?? 0));

    const response = await apiClient.get(`/stock-deficits?${params.toString()}`);
    // The list envelope is not wrapped in `data`, so the rows are unwrapped here
    // and the aggregate totals are lifted to numbers for the summary line.
    const body = response?.data ?? {};
    return {
      data: (body?.data ?? []) as StockDeficitRow[],
      total: Number(body?.total ?? 0),
      limit: Number(body?.limit ?? 50),
      offset: Number(body?.offset ?? 0),
      openCount: Number(body?.openCount ?? 0),
      openQuantity: body?.openQuantity ?? '0.000',
    } as StockDeficitListResponse;
  },

  async forItem(itemPublicId: string) {
    const response = await apiClient.get(`/stock-deficits/item/${encodeURIComponent(itemPublicId)}`);
    return unwrap<{ openCount: number; openQuantity: DecimalValue; data: StockDeficitRow[] }>(response.data);
  },

  async writeOff(publicId: string, reason: string) {
    // Resolving a deficit is a state change, so it carries an idempotency key:
    // a double click must not write off twice, and a retry after a dropped
    // connection must not create a second decision.
    const response = await apiClient.post(
      `/stock-deficits/${encodeURIComponent(publicId)}/write-off`,
      { reason },
      { headers: { 'Idempotency-Key': `deficit-writeoff-${publicId}` } },
    );
    return unwrap<StockDeficitRow>(response.data);
  },

  async reopen(publicId: string) {
    const response = await apiClient.post(
      `/stock-deficits/${encodeURIComponent(publicId)}/reopen`,
      {},
      { headers: { 'Idempotency-Key': `deficit-reopen-${publicId}` } },
    );
    return unwrap<StockDeficitRow>(response.data);
  },
};
