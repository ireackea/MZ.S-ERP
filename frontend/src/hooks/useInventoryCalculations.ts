import { useEffect, useMemo, useState } from 'react';
import { Item, Transaction } from '../types';
import { getTransactions } from '../services/legacy/storage';
import { calculateBalancesMap, getFinancialYearFromDate } from '../services/legacy/openingBalanceService';
import { getComputedBalancesFromApi, getTransactionsFromApi } from '@services/transactionsService';

interface UseInventoryCalculationsParams {
  items: Item[];
  openingQuantities?: Map<string, number> | null;
  transactions?: Transaction[];
}

type StockStatus = {
  balance: number;
  isBelowMin: boolean;
  isBelowOrder: boolean;
};

export const useInventoryCalculations = ({
  items,
  openingQuantities,
  transactions,
}: UseInventoryCalculationsParams) => {
  const financialYear = useMemo(() => getFinancialYearFromDate(), []);
  const shouldUseApiSource = transactions == null;

  const [remoteTransactions, setRemoteTransactions] = useState<Transaction[] | null>(null);
  const [remoteBalances, setRemoteBalances] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    if (!shouldUseApiSource) {
      setRemoteTransactions(null);
      setRemoteBalances(null);
      return;
    }

    let cancelled = false;

    const syncFromApi = async () => {
      try {
        const [txRows, computedRows] = await Promise.all([
          getTransactionsFromApi({ page: 1, limit: 10000 }),
          getComputedBalancesFromApi(financialYear),
        ]);

        if (cancelled) return;

        setRemoteTransactions(txRows);

        const map = new Map<string, number>();
        computedRows.forEach((row) => {
          if (!row.itemId) return;
          map.set(String(row.itemId), Number(row.currentStock ?? 0));
        });
        setRemoteBalances(map);
      } catch {
        if (cancelled) return;
        // Fallback: keep feature parity using local cache when API is unavailable.
        setRemoteTransactions(getTransactions());
        setRemoteBalances(null);
      }
    };

    void syncFromApi();

    return () => {
      cancelled = true;
    };
  }, [financialYear, shouldUseApiSource]);

  const txSource = useMemo(() => {
    if (transactions) return transactions;
    if (remoteTransactions) return remoteTransactions;
    return getTransactions();
  }, [transactions, remoteTransactions]);

  const calculatedBalanceMap = useMemo(
    () =>
      calculateBalancesMap({
        items,
        transactions: txSource,
        financialYear,
        openingQuantities: openingQuantities ?? undefined,
      }),
    [items, txSource, financialYear, openingQuantities]
  );

  const balanceMap = useMemo(() => {
    if (!shouldUseApiSource || !remoteBalances || remoteBalances.size === 0) {
      return calculatedBalanceMap;
    }

    const merged = new Map<string, number>();
    items.forEach((item) => {
      const value = remoteBalances.get(String(item.id));
      merged.set(String(item.id), Number.isFinite(Number(value)) ? Number(value) : 0);
    });
    return merged;
  }, [shouldUseApiSource, remoteBalances, items, calculatedBalanceMap]);

  const stockStatusMap = useMemo(() => {
    const next = new Map<string, StockStatus>();
    items.forEach((item) => {
      const balance = Number(balanceMap.get(item.id) ?? 0);
      const minLimit = Number(item.minLimit ?? 0);
      const orderLimit = item.orderLimit == null ? undefined : Number(item.orderLimit);

      next.set(item.id, {
        balance,
        isBelowMin: Number.isFinite(minLimit) ? balance < minLimit : false,
        isBelowOrder:
          orderLimit != null && Number.isFinite(orderLimit) ? balance <= orderLimit : false,
      });
    });
    return next;
  }, [items, balanceMap]);

  const formatBalanceNumber = (value?: number) => {
    const numericValue = Number(value ?? 0);
    return numericValue.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  };

  return {
    financialYear,
    txSource,
    balanceMap,
    stockStatusMap,
    formatBalanceNumber,
  };
};
