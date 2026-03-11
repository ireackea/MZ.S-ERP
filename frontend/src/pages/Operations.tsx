// ENTERPRISE FIX: Phase 3 - Full Legacy Removal & Complete Single Source of Truth - 2026-03-05
import React, { useEffect, useMemo } from 'react';
import DailyOperations from '../components/DailyOperations';
import { getAuthUser } from '../services/authService';
import {
  getPartners,
  getSettings,
  getUnloadingRules,
  saveTransactions,
} from '../services/storage';
import {
  bulkCreateTransactions,
  deleteTransactionsInApi,
  getTransactionsFromApi,
  updateTransactionInApi,
} from '../services/transactionsService';
import { useInventoryStore } from '../store/useInventoryStore';
import { toast } from '@services/toastService';
import type { Partner, SystemSettings, Transaction, UnloadingRule } from '../types';

const OperationsPage: React.FC = () => {
  const items = useInventoryStore((state) => state.items);
  const transactions = useInventoryStore((state) => state.transactions);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const setInventoryTransactions = useInventoryStore((state) => state.setTransactions);
  const updateStockFromTransaction = useInventoryStore((state) => state.updateStockFromTransaction);

  const authUser = getAuthUser();
  const partners = useMemo<Partner[]>(() => getPartners(), []);
  const settings = useMemo<SystemSettings>(() => getSettings(), []);
  const unloadingRules = useMemo<UnloadingRule[]>(() => getUnloadingRules(), []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const visibleTransactions = useMemo(
    () => [...transactions].sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0)),
    [transactions],
  );

  const handleAddTransaction = async (rows: Transaction[]) => {
    try {
      const created = await bulkCreateTransactions(rows);
      const nextRows = created.length > 0 ? created : rows;
      const merged = [...transactions, ...nextRows];
      setInventoryTransactions(merged);
      saveTransactions(merged);
      nextRows.forEach((row) => updateStockFromTransaction(row, 'add'));
    } catch (error) {
      console.warn('[OperationsPage] Failed to create transactions in API, using local fallback:', error);
      const merged = [...transactions, ...rows];
      setInventoryTransactions(merged);
      saveTransactions(merged);
      rows.forEach((row) => updateStockFromTransaction(row, 'add'));
      toast.error('تعذر مزامنة الحركات مع الخادم. تم حفظها محليًا فقط.');
    }
  };

  const handleUpdateTransaction = async (row: Transaction) => {
    const previous = transactions.find((entry) => entry.id === row.id);
    if (!previous) return;

    try {
      const saved = await updateTransactionInApi(row.id, row);
      const updated = transactions.map((entry) => (entry.id === saved.id ? saved : entry));
      setInventoryTransactions(updated);
      saveTransactions(updated);
      updateStockFromTransaction(saved, 'update', previous);
    } catch (error) {
      console.warn('[OperationsPage] Failed to update transaction in API, using local fallback:', error);
      const updated = transactions.map((entry) => (entry.id === row.id ? row : entry));
      setInventoryTransactions(updated);
      saveTransactions(updated);
      updateStockFromTransaction(row, 'update', previous);
      toast.error('تعذر تحديث الحركة على الخادم. تم تحديث النسخة المحلية.');
    }
  };

  const handleDeleteTransactions = async (ids: string[]) => {
    const affected = transactions.filter((row) => ids.includes(String(row.id)));
    try {
      await deleteTransactionsInApi(ids);
      const nextRows = transactions.filter((row) => !ids.includes(String(row.id)));
      setInventoryTransactions(nextRows);
      saveTransactions(nextRows);
      affected.forEach((row) => updateStockFromTransaction(row, 'remove'));
    } catch (error) {
      console.warn('[OperationsPage] Failed to delete transactions in API, using local fallback:', error);
      const nextRows = transactions.filter((row) => !ids.includes(String(row.id)));
      setInventoryTransactions(nextRows);
      saveTransactions(nextRows);
      affected.forEach((row) => updateStockFromTransaction(row, 'remove'));
      toast.error('تعذر حذف الحركات من الخادم. تمت إزالة النسخة المحلية.');
    }
  };

  return (
    <DailyOperations
      items={items}
      transactions={visibleTransactions}
      partners={partners}
      settings={settings}
      unloadingRules={unloadingRules}
      onAddTransaction={(rows) => void handleAddTransaction(rows)}
      onUpdateTransaction={(row) => void handleUpdateTransaction(row)}
      onDeleteTransactions={(ids) => void handleDeleteTransactions(ids)}
      currentUserId={String(authUser?.id || '')}
    />
  );
};

export default OperationsPage;
