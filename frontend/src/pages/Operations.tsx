// ENTERPRISE FIX: Legacy Migration Phase 2 - Operations Page - 2026-02-27
// ENTERPRISE FIX: Legacy Migration Phase 3 - Professional PDF Reporting - 2026-02-27
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import {
  CalendarRange,
  CheckSquare,
  Download,
  Loader2,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from '@services/toastService';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';
import { getItems, type ItemDto } from '@services/itemsService';
import {
  createTransactionInApi,
  deleteTransactionsInApi,
  getTransactionsFromApi,
} from '@services/transactionsService';
import type { Item, OperationType, Transaction } from '../types';

type OperationsStoreState = {
  items: Item[];
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  isSubmitting: boolean;
  loadData: () => Promise<void>;
  updateStockFromTransaction: (
    transaction: Transaction,
    action: 'add' | 'remove' | 'update',
    oldTransaction?: Transaction,
  ) => void;
  addTransaction: (payload: Transaction) => Promise<void>;
  bulkDelete: (ids: string[]) => Promise<number>;
};

type TransactionFormValues = {
  date: string;
  itemId: string;
  type: OperationType;
  quantity: string;
  supplierOrReceiver: string;
  warehouseInvoice: string;
  notes: string;
  createdByUserId: string;
};

const TRANSACTION_TYPES: OperationType[] = ['7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7��"7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�#�⬑"�7�⬠7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#��"�'];

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const mapItemDtoToItem = (row: ItemDto): Item => ({
  id: String(row.publicId || row.id),
  code: row.code || undefined,
  barcode: row.barcode || undefined,
  name: row.name,
  englishName: row.description || undefined,
  category: row.category || '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7��7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
  unit: row.unit || '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
  minLimit: toNumber(row.minLimit, 0),
  maxLimit: toNumber(row.maxLimit, 1000),
  orderLimit: row.orderLimit == null ? undefined : toNumber(row.orderLimit, 0),
  currentStock: toNumber(row.currentStock, 0),
  lastUpdated: new Date().toISOString(),
});

const useInventoryStore = create<OperationsStoreState>((set, get) => ({
  items: [],
  transactions: [],
  loading: false,
  error: null,
  isSubmitting: false,

  loadData: async () => {
    set({ loading: true, error: null });
    try {
      const [itemRows, transactionRows] = await Promise.all([
        getItems(),
        getTransactionsFromApi({ page: 1, limit: 10000 }),
      ]);
      set({
        items: itemRows.map(mapItemDtoToItem),
        transactions: transactionRows,
        loading: false,
      });
    } catch (error: any) {
      set({
        loading: false,
        error: error?.response?.data?.message || error?.message || 'Failed to load operations data.',
      });
    }
  },

  updateStockFromTransaction: (transaction, action, oldTransaction) => {
    set((state) => {
      const items = [...state.items];

      const applyDelta = (targetItemId: string, type: OperationType, quantity: number, direction: 1 | -1) => {
        const index = items.findIndex((item) => String(item.id) === String(targetItemId));
        if (index < 0) return;
        const current = { ...items[index] };
        const q = toNumber(quantity, 0);
        if (type === '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�' || type === '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�') current.currentStock += q * direction;
        else current.currentStock -= q * direction;
        current.lastUpdated = new Date().toISOString();
        items[index] = current;
      };

      if (action === 'add') {
        applyDelta(transaction.itemId, transaction.type, transaction.quantity, 1);
      } else if (action === 'remove') {
        applyDelta(transaction.itemId, transaction.type, transaction.quantity, -1);
      } else if (action === 'update' && oldTransaction) {
        applyDelta(oldTransaction.itemId, oldTransaction.type, oldTransaction.quantity, -1);
        applyDelta(transaction.itemId, transaction.type, transaction.quantity, 1);
      }

      return { items };
    });
  },

  addTransaction: async (payload) => {
    set({ isSubmitting: true });
    try {
      const saved = await createTransactionInApi(payload);
      set((state) => ({
        transactions: [...state.transactions, saved],
      }));
      get().updateStockFromTransaction(saved, 'add');
    } finally {
      set({ isSubmitting: false });
    }
  },

  bulkDelete: async (ids) => {
    const uniqueIds = Array.from(new Set(ids.map(String)));
    if (!uniqueIds.length) return 0;

    const toRemove = get().transactions.filter((row) => uniqueIds.includes(String(row.id)));
    const deleted = await deleteTransactionsInApi(uniqueIds);

    set((state) => ({
      transactions: state.transactions.filter((row) => !uniqueIds.includes(String(row.id))),
    }));
    toRemove.forEach((row) => get().updateStockFromTransaction(row, 'remove'));
    return deleted;
  },
}));

const OperationsPage: React.FC = () => {
  const { data: session } = useSession();
  const { hasPermission } = usePermissions();
  const {
    items,
    transactions,
    loading,
    error,
    isSubmitting,
    loadData,
    addTransaction,
    bulkDelete,
  } = useInventoryStore();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | OperationType>('all');
  const [itemFilter, setItemFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  const canView = hasPermission('*') || hasPermission('transactions.view') || hasPermission('inventory.view.stock');
  const canCreate =
    hasPermission('*') ||
    hasPermission('transactions.create') ||
    hasPermission('inventory.create.inbound') ||
    hasPermission('inventory.create.outbound');
  const canDelete = hasPermission('*') || hasPermission('transactions.delete') || hasPermission('inventory.delete.transactions');

  const currentUserId = String(session?.user?.id || '');

  const [form, setForm] = useState<TransactionFormValues>({
    date: new Date().toISOString().split('T')[0],
    itemId: '',
    type: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
    quantity: '',
    supplierOrReceiver: '',
    warehouseInvoice: '',
    notes: '',
    createdByUserId: currentUserId,
  });

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!modalOpen) return;
    setForm((prev) => ({
      ...prev,
      createdByUserId: String(session?.user?.id || prev.createdByUserId || ''),
    }));
  }, [modalOpen, session?.user?.id]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => {
      map.set(String(item.id), item.name);
    });
    return map;
  }, [items]);

  const users = useMemo(
    () =>
      Array.from(
        new Set(
          transactions
            .map((row) => String(row.createdByUserId || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [transactions],
  );

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return transactions.filter((row) => {
      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      if (itemFilter !== 'all' && String(row.itemId) !== itemFilter) return false;
      if (userFilter !== 'all' && String(row.createdByUserId || '') !== userFilter) return false;

      const rowTime = new Date(row.date).getTime();
      if (from != null && rowTime < from) return false;
      if (to != null && rowTime > to) return false;

      if (!q) return true;

      const itemName = itemNameById.get(String(row.itemId)) || '';
      return (
        String(row.warehouseInvoice || '').toLowerCase().includes(q) ||
        String(row.supplierOrReceiver || '').toLowerCase().includes(q) ||
        String(row.notes || '').toLowerCase().includes(q) ||
        String(itemName).toLowerCase().includes(q) ||
        String(row.createdByUserId || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, typeFilter, itemFilter, userFilter, dateFrom, dateTo, search, itemNameById]);

  const stats = useMemo(() => {
    const inbound = filteredTransactions.filter((row) => row.type === '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�').length;
    const outbound = filteredTransactions.filter((row) => row.type === '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�').length;
    return {
      total: filteredTransactions.length,
      inbound,
      outbound,
      selected: selectedIds.size,
    };
  }, [filteredTransactions, selectedIds.size]);

  const selectAllChecked =
    filteredTransactions.length > 0 &&
    filteredTransactions.every((row) => selectedIds.has(String(row.id)));

  const toggleSelectAll = () => {
    if (selectAllChecked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredTransactions.forEach((row) => next.delete(String(row.id)));
        return next;
      });
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredTransactions.forEach((row) => next.add(String(row.id)));
      return next;
    });
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setForm({
      date: new Date().toISOString().split('T')[0],
      itemId: '',
      type: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
      quantity: '',
      supplierOrReceiver: '',
      warehouseInvoice: '',
      notes: '',
      createdByUserId: String(session?.user?.id || ''),
    });
  };

  const onAddTransaction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) {
      toast.error('You do not have permission to create transactions.');
      return;
    }
    if (!form.date || !form.itemId || !form.supplierOrReceiver.trim() || !form.quantity.trim()) {
      toast.error('Date, item, quantity, and supplier/receiver are required.');
      return;
    }

    const quantity = toNumber(form.quantity, NaN);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Quantity must be greater than 0.');
      return;
    }

    const payload: Transaction = {
      id: crypto.randomUUID(),
      date: form.date,
      itemId: form.itemId,
      type: form.type,
      quantity,
      supplierOrReceiver: form.supplierOrReceiver.trim(),
      warehouseInvoice: form.warehouseInvoice.trim() || `TRX-${Date.now()}`,
      notes: form.notes.trim() || undefined,
      createdByUserId: form.createdByUserId.trim() || undefined,
      timestamp: Date.now(),
    };

    try {
      await addTransaction(payload);
      toast.success('Transaction created successfully.');
      setModalOpen(false);
      resetForm();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || 'Failed to create transaction.');
    }
  };

  const onBulkDelete = async () => {
    if (!canDelete) {
      toast.error('You do not have permission to delete transactions.');
      return;
    }
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const confirmed = window.confirm(`Delete ${ids.length} selected transaction(s)?`);
    if (!confirmed) return;

    try {
      const deleted = await bulkDelete(ids);
      setSelectedIds(new Set());
      toast.success(`Deleted ${deleted} transaction(s).`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || 'Failed to delete selected rows.');
    }
  };

  const onExportExcel = () => {
    if (!filteredTransactions.length) {
      toast.error('No rows to export.');
      return;
    }
    const rows = filteredTransactions.map((row) => ({
      ID: row.id,
      Date: row.date,
      Type: row.type,
      ItemId: row.itemId,
      ItemName: itemNameById.get(String(row.itemId)) || row.itemId,
      Quantity: row.quantity,
      Partner: row.supplierOrReceiver,
      WarehouseInvoice: row.warehouseInvoice,
      CreatedByUserId: row.createdByUserId || '',
      Notes: row.notes || '',
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Operations');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    XLSX.writeFile(book, `operations-${stamp}.xlsx`);
    toast.success('Excel exported successfully.');
  };

  const onPrintOperationsPdf = async () => {
    if (!filteredTransactions.length) {
      toast.error('No rows to print.');
      return;
    }

    try {
      const token = localStorage.getItem('feed_factory_jwt_token') || '';
      const payload = {
        type: 'transactions',
        title: 'Operations Report',
        subtitle: 'Filtered transactions report',
        filename: `operations-${new Date().toISOString().slice(0, 10)}`,
        data: {
          transactions: filteredTransactions.map((row) => ({
            date: row.date,
            type: row.type,
            itemName: itemNameById.get(String(row.itemId)) || row.itemId,
            quantity: row.quantity,
            supplierOrReceiver: row.supplierOrReceiver,
            warehouseInvoice: row.warehouseInvoice,
            createdByUserId: row.createdByUserId || '-',
          })),
          filters: {
            search,
            typeFilter,
            itemFilter,
            userFilter,
            dateFrom,
            dateTo,
          },
        },
      };

      const response = await fetch('/api/reports/print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Failed to generate operations PDF.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `operations-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Operations PDF generated successfully.');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to generate operations PDF.');
    }
  };

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <div className="mb-2 flex items-center gap-2 text-base font-bold">
          <ShieldAlert size={18} />
          <span>Access denied to Operations page</span>
        </div>
        <p className="text-sm">Required permission: <code>transactions.view</code> or SuperAdmin wildcard.</p>
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Operations</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Transactions management with real-time stock balance updates.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCcw size={16} />
              Refresh
            </button>
            {canCreate && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <Plus size={16} />
                Add New Transaction
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Total Rows</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Inbound</p>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{stats.inbound}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-3 dark:bg-red-950/30">
            <p className="text-xs text-red-600 dark:text-red-400">Outbound</p>
            <p className="text-xl font-bold text-red-700 dark:text-red-300">{stats.outbound}</p>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Selected</p>
            <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{stats.selected}</p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice, item, partner, notes..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-2 py-1.5 dark:border-slate-700">
            <CalendarRange size={14} className="text-slate-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-md bg-transparent px-1 text-sm outline-none dark:text-slate-100"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-md bg-transparent px-1 text-sm outline-none dark:text-slate-100"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">All Types</option>
            {TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <select
            value={itemFilter}
            onChange={(event) => setItemFilter(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">All Items</option>
            {items.map((item) => (
              <option key={String(item.id)} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>

          <select
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">All Users</option>
            {users.map((userId) => (
              <option key={userId} value={userId}>{userId}</option>
            ))}
          </select>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onPrintOperationsPdf()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Printer size={15} />
            Print PDF
          </button>
          <button
            type="button"
            onClick={onExportExcel}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download size={15} />
            Export to Excel
          </button>
          <button
            type="button"
            onClick={() => void onBulkDelete()}
            disabled={!selectedIds.size || !canDelete}
            className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <Trash2 size={15} />
            Bulk Delete
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <tr>
                <th className="px-3 py-2 text-right">
                  <button type="button" onClick={toggleSelectAll}>
                    {selectAllChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-3 py-2 text-right">Date</th>
                <th className="px-3 py-2 text-right">Type</th>
                <th className="px-3 py-2 text-right">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Current Balance</th>
                <th className="px-3 py-2 text-right">Partner</th>
                <th className="px-3 py-2 text-right">User</th>
                <th className="px-3 py-2 text-right">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Loading operations...
                    </span>
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-red-600">{error}</td>
                </tr>
              )}
              {!loading && !error && filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No transactions found for current filters.
                  </td>
                </tr>
              )}
              {!loading && !error && filteredTransactions.map((row) => {
                const id = String(row.id);
                const balance = items.find((item) => String(item.id) === String(row.itemId))?.currentStock;
                return (
                  <tr key={id} className="border-t border-slate-200 hover:bg-slate-50/70 dark:border-slate-700 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => toggleSelectOne(id)}>
                        {selectedIds.has(id) ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-2">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          row.type === '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�' || row.type === '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                      >
                        {row.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                      {itemNameById.get(String(row.itemId)) || row.itemId}
                    </td>
                    <td className="px-3 py-2">{row.quantity}</td>
                    <td className="px-3 py-2 font-semibold">{toNumber(balance, 0).toLocaleString()}</td>
                    <td className="px-3 py-2">{row.supplierOrReceiver}</td>
                    <td className="px-3 py-2">{row.createdByUserId || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">{row.warehouseInvoice}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setModalOpen(false);
            }}
          >
            <motion.form
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              onSubmit={onAddTransaction}
              className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Add New Transaction</h2>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Date *</span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    required
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Type *</span>
                  <select
                    value={form.type}
                    onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as OperationType }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {TRANSACTION_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Item *</span>
                  <select
                    value={form.itemId}
                    onChange={(event) => setForm((prev) => ({ ...prev, itemId: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    required
                  >
                    <option value="">Select Item</option>
                    {items.map((item) => (
                      <option key={String(item.id)} value={String(item.id)}>
                        {item.name} ({item.code || String(item.id)})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Quantity *</span>
                  <input
                    type="number"
                    min={0.001}
                    step="0.001"
                    value={form.quantity}
                    onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    required
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">User</span>
                  <input
                    value={form.createdByUserId}
                    onChange={(event) => setForm((prev) => ({ ...prev, createdByUserId: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Partner *</span>
                  <input
                    value={form.supplierOrReceiver}
                    onChange={(event) => setForm((prev) => ({ ...prev, supplierOrReceiver: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    required
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Invoice #</span>
                  <input
                    value={form.warehouseInvoice}
                    onChange={(event) => setForm((prev) => ({ ...prev, warehouseInvoice: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Notes</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                  Save Transaction
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
};

export default OperationsPage;

