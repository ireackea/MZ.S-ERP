// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import apiClient from '@api/client';
import { Transaction } from '../types';

type ApiListResponse = {
  data?: any[];
  total?: number;
  page?: number;
  limit?: number;
};

export type ComputedBalanceRow = {
  itemId: string;
  currentStock: number;
  lastUpdated: string | null;
};

export type ComputedBalancesResponse = {
  financialYear: number;
  total: number;
  data: ComputedBalanceRow[];
};

export type MigrateFromLocalResponse = {
  total: number;
  migrated: number;
  skipped: number;
  data?: any[];
};

const normalizeApiTransaction = (row: any): Transaction => {
  const fallbackTimestamp = Date.parse(row?.date || '') || Date.now();

  return {
    id: String(row?.id ?? row?.publicId ?? crypto.randomUUID()),
    date: String(row?.date || new Date().toISOString().split('T')[0]),
    itemId: String(row?.itemId ?? row?.item?.publicId ?? row?.item?.id ?? ''),
    type: String(row?.type || '7"7"7"7"7"7"7"#⬑"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"') as Transaction['type'],
    quantity: Number(row?.quantity ?? 0),
    warehouseInvoice: String(row?.warehouseInvoice ?? ''),
    supplierOrReceiver: String(row?.supplierOrReceiver ?? ''),
    supplierNet: row?.supplierNet == null ? undefined : Number(row.supplierNet),
    difference: row?.difference == null ? undefined : Number(row.difference),
    packageCount: row?.packageCount == null ? undefined : Number(row.packageCount),
    supplierInvoice: row?.supplierInvoice ?? undefined,
    weightSlip: row?.weightSlip ?? undefined,
    truckNumber: row?.truckNumber ?? undefined,
    trailerNumber: row?.trailerNumber ?? undefined,
    driverName: row?.driverName ?? undefined,
    entryTime: row?.entryTime ?? undefined,
    exitTime: row?.exitTime ?? undefined,
    unloadingRuleId: row?.unloadingRuleId ?? undefined,
    unloadingDuration: row?.unloadingDuration == null ? undefined : Number(row.unloadingDuration),
    delayDuration: row?.delayDuration == null ? undefined : Number(row.delayDuration),
    delayPenalty: row?.delayPenalty == null ? undefined : Number(row.delayPenalty),
    calculatedFine: row?.calculatedFine == null ? undefined : Number(row.calculatedFine),
    notes: row?.notes ?? undefined,
    attachmentData: row?.attachmentData ?? undefined,
    attachmentName: row?.attachmentName ?? undefined,
    attachmentType: row?.attachmentType ?? undefined,
    googleDriveLink: row?.googleDriveLink ?? undefined,
    warehouseId: row?.warehouseId ?? undefined,
    createdByUserId: row?.createdByUserId ?? undefined,
    timestamp: Number(row?.timestamp ?? fallbackTimestamp),
  };
};

const toCreatePayload = (transaction: Transaction, options?: { includeId?: boolean }) => ({
  ...(options?.includeId ? { id: transaction.id } : {}),
  itemId: transaction.itemId,
  date: transaction.date,
  type: transaction.type,
  quantity: Number(transaction.quantity ?? 0),
  supplierOrReceiver: transaction.supplierOrReceiver,
  warehouseId: transaction.warehouseId,
  warehouseInvoice: transaction.warehouseInvoice,
  supplierInvoice: transaction.supplierInvoice,
  supplierNet: transaction.supplierNet,
  difference: transaction.difference,
  packageCount: transaction.packageCount,
  weightSlip: transaction.weightSlip,
  truckNumber: transaction.truckNumber,
  trailerNumber: transaction.trailerNumber,
  driverName: transaction.driverName,
  entryTime: transaction.entryTime,
  exitTime: transaction.exitTime,
  unloadingRuleId: transaction.unloadingRuleId,
  unloadingDuration: transaction.unloadingDuration,
  delayDuration: transaction.delayDuration,
  delayPenalty: transaction.delayPenalty,
  calculatedFine: transaction.calculatedFine,
  notes: transaction.notes,
  attachmentData: transaction.attachmentData,
  attachmentName: transaction.attachmentName,
  attachmentType: transaction.attachmentType,
  googleDriveLink: transaction.googleDriveLink,
  createdByUserId: transaction.createdByUserId,
  timestamp: transaction.timestamp,
});

const extractRows = (payload: ApiListResponse | any[]): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

export const getTransactionsFromApi = async (params?: {
  page?: number;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  itemId?: string;
  type?: string;
  search?: string;
}): Promise<Transaction[]> => {
  const response = await apiClient.get<ApiListResponse | any[]>('/transactions', { params });
  return extractRows(response.data).map(normalizeApiTransaction);
};

export const getTransactionByIdFromApi = async (id: string): Promise<Transaction> => {
  const response = await apiClient.get(`/transactions/${encodeURIComponent(id)}`);
  return normalizeApiTransaction(response.data);
};

export const createTransactionInApi = async (transaction: Transaction): Promise<Transaction> => {
  const response = await apiClient.post('/transactions', toCreatePayload(transaction));
  return normalizeApiTransaction(response.data);
};

export const bulkCreateTransactions = async (transactions: Transaction[]): Promise<Transaction[]> => {
  const response = await apiClient.post('/transactions/bulk', {
    transactions: transactions.map((tx) => toCreatePayload(tx)),
  });

  return extractRows(response.data).map(normalizeApiTransaction);
};

export const bulkImportTransactions = async (transactions: Transaction[]): Promise<Transaction[]> => {
  const response = await apiClient.post('/transactions/bulk-import', {
    transactions: transactions.map((tx) => toCreatePayload(tx)),
  });

  return extractRows(response.data).map(normalizeApiTransaction);
};

export const migrateFromLocalTransactions = async (
  transactions: Transaction[],
): Promise<MigrateFromLocalResponse> => {
  const response = await apiClient.post('/transactions/migrate-from-local', {
    transactions: transactions.map((tx) => toCreatePayload(tx, { includeId: true })),
  });
  return response.data as MigrateFromLocalResponse;
};

export const updateTransactionInApi = async (
  id: string,
  transaction: Transaction,
): Promise<Transaction> => {
  try {
    const response = await apiClient.put(`/transactions/${encodeURIComponent(id)}`, toCreatePayload(transaction));
    return normalizeApiTransaction(response.data);
  } catch (error: any) {
    // Backward compatibility with older backend versions that still use PATCH only.
    if (error?.response?.status === 404 || error?.response?.status === 405) {
      const response = await apiClient.patch(`/transactions/${encodeURIComponent(id)}`, toCreatePayload(transaction));
      return normalizeApiTransaction(response.data);
    }
    throw error;
  }
};

export const deleteTransactionByIdInApi = async (id: string): Promise<number> => {
  const response = await apiClient.delete(`/transactions/${encodeURIComponent(id)}`);
  return Number(response.data?.deleted ?? 0);
};

export const deleteTransactionsInApi = async (ids: string[]): Promise<number> => {
  const response = await apiClient.post('/transactions/delete', { ids });
  return Number(response.data?.deleted ?? 0);
};

export const getComputedBalancesFromApi = async (financialYear?: number): Promise<ComputedBalanceRow[]> => {
  const response = await apiClient.get<ComputedBalancesResponse | ComputedBalanceRow[]>('/balances/computed', {
    params: financialYear ? { financialYear } : undefined,
  });

  const payload = response.data as any;
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];

  return rows.map((row: any) => ({
    itemId: String(row?.itemId ?? ''),
    currentStock: Number(row?.currentStock ?? 0),
    lastUpdated: row?.lastUpdated ? String(row.lastUpdated) : null,
  }));
};

