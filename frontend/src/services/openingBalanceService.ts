// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import apiClient from '@api/client';

export interface OpeningBalancePayload {
  itemPublicId: string;
  financialYear: number;
  quantity: number;
  unitCost?: number;
}

export const getOpeningBalances = async (year: number) => {
  const res = await apiClient.get(`/opening-balances/${year}`);
  return res.data;
};

export const setOpeningBalance = async (payload: OpeningBalancePayload) => {
  const res = await apiClient.post('/opening-balances', payload);
  return res.data;
};

export const bulkUpsertOpeningBalances = async (bulk: OpeningBalancePayload[]) => {
  const res = await apiClient.post('/opening-balances/bulk', { bulk });
  return res.data;
};

export {
  upsertOpeningBalances,
  upsertOpeningBalancesByPeriod,
  getOpeningBalancesByYear,
  getOpeningBalancesByPeriod,
  getFinancialYearFromDate,
  getOpeningQuantity,
  getOpeningQuantityByPeriod,
  calculateCurrentBalance,
  calculateBalancesMap,
} from './legacy/openingBalanceService';
