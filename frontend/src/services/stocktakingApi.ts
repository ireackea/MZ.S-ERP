import apiClient from '../api/client';

export type StocktakingApiSession = {
  id: string;
  monthKey: string;
  warehouseId: string;
  status: 'open' | 'closed';
  closed: boolean;
  closedAt?: string;
  closedById?: string;
  archivedPdfName?: string;
  archivedPdfMime?: string;
  archivedPdfData?: string;
  entries: Array<{
    id: string;
    itemId: string;
    itemName: string;
    actualCount?: number;
    notes?: string;
    counts: Array<{ userId?: string; value: number; at: string }>;
  }>;
};

const unwrap = <T>(payload: any): T => (payload?.data ?? payload) as T;

export const stocktakingApi = {
  async get(monthKey: string, warehouseId = 'default'): Promise<StocktakingApiSession | null> {
    const response = await apiClient.get(`/stocktaking/${encodeURIComponent(monthKey)}`, { params: { warehouseId } });
    return unwrap<StocktakingApiSession | null>(response.data);
  },
  async create(monthKey: string, warehouseId = 'default', idempotencyKey = `stocktaking-create-${crypto.randomUUID()}`): Promise<StocktakingApiSession> {
    const response = await apiClient.post('/stocktaking', { monthKey, warehouseId }, { headers: { 'Idempotency-Key': idempotencyKey } });
    return unwrap<StocktakingApiSession>(response.data);
  },
  async upsertEntry(sessionId: string, input: { itemId: string; actualCount: number; notes?: string }, idempotencyKey = `stocktaking-entry-${crypto.randomUUID()}`): Promise<StocktakingApiSession> {
    const response = await apiClient.put(`/stocktaking/${encodeURIComponent(sessionId)}/entries`, input, { headers: { 'Idempotency-Key': idempotencyKey } });
    return unwrap<StocktakingApiSession>(response.data);
  },
  async resolveEntry(sessionId: string, entryId: string, input: { itemId: string; actualCount: number; notes?: string }, idempotencyKey = `stocktaking-resolve-${crypto.randomUUID()}`): Promise<StocktakingApiSession> {
    const response = await apiClient.post(`/stocktaking/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/resolve`, input, { headers: { 'Idempotency-Key': idempotencyKey } });
    return unwrap<StocktakingApiSession>(response.data);
  },
  async close(sessionId: string, input: { archivedPdfName?: string; archivedPdfMime?: string; archivedPdfData?: string }, idempotencyKey = `stocktaking-close-${crypto.randomUUID()}`): Promise<StocktakingApiSession> {
    const response = await apiClient.post(`/stocktaking/${encodeURIComponent(sessionId)}/close`, input, { headers: { 'Idempotency-Key': idempotencyKey } });
    return unwrap<StocktakingApiSession>(response.data);
  },
};
