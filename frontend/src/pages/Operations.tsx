// ENTERPRISE FIX: Phase 6.5 - Absolute 100% Cleanup & Global Verification - 2026-03-13
import React, { useEffect, useMemo } from 'react';
import DailyOperations from '../components/DailyOperations';
import { getAuthUser } from '../services/authService';
import {
  bulkCreateTransactions,
  deleteTransactionsInApi,
  updateTransactionInApi,
} from '../services/transactionsService';
import { useInventoryStore } from '../store/useInventoryStore';
import { toast } from '@services/toastService';
import type { Partner, SystemSettings, Transaction, UnloadingRule } from '../types';

const DEFAULT_SETTINGS: SystemSettings = {
  companyName: '',
  currency: 'EGP',
  address: '',
  phone: '',
  defaultUnloadingDuration: 60,
  defaultDelayPenalty: 0,
};

const OperationsPage: React.FC = () => {
  const items = useInventoryStore((state) => state.items);
  const transactions = useInventoryStore((state) => state.transactions);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const setInventoryTransactions = useInventoryStore((state) => state.setTransactions);
  const updateStockFromTransaction = useInventoryStore((state) => state.updateStockFromTransaction);

  const authUser = getAuthUser();
  const partners = useMemo<Partner[]>(() => {
    const uniqueNames = Array.from(
      new Set(
        transactions
          .map((row) => String(row.supplierOrReceiver || '').trim())
          .filter(Boolean)
      )
    );

    return uniqueNames.map((name, index) => ({
      id: `derived-partner-${index}`,
      name,
      type: 'supplier',
      phone: '',
    }));
  }, [transactions]);
  const settings = useMemo<SystemSettings>(() => DEFAULT_SETTINGS, []);
  const unloadingRules = useMemo<UnloadingRule[]>(() => [], []);

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
      nextRows.forEach((row) => updateStockFromTransaction(row, 'add'));
    } catch (error) {
      console.error('[OperationsPage] Failed to create transactions in API:', error);
      toast.error('تعذر إنشاء الحركات على الخادم. لم يتم تنفيذ حفظ محلي احتياطي.');
    }
  };

  const handleUpdateTransaction = async (row: Transaction) => {
    const previous = transactions.find((entry) => entry.id === row.id);
    if (!previous) return;

    try {
      const saved = await updateTransactionInApi(row.id, row);
      const updated = transactions.map((entry) => (entry.id === saved.id ? saved : entry));
      setInventoryTransactions(updated);
      updateStockFromTransaction(saved, 'update', previous);
    } catch (error) {
      console.error('[OperationsPage] Failed to update transaction in API:', error);
      toast.error('تعذر تحديث الحركة على الخادم. لم يتم تطبيق fallback محلي.');
    }
  };

  const handleDeleteTransactions = async (ids: string[]) => {
    const affected = transactions.filter((row) => ids.includes(String(row.id)));
    try {
      await deleteTransactionsInApi(ids);
      const nextRows = transactions.filter((row) => !ids.includes(String(row.id)));
      setInventoryTransactions(nextRows);
      affected.forEach((row) => updateStockFromTransaction(row, 'remove'));
    } catch (error) {
      console.error('[OperationsPage] Failed to delete transactions in API:', error);
      toast.error('تعذر حذف الحركات من الخادم. لم يتم تنفيذ fallback محلي.');
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
