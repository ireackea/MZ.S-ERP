// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
// ENTERPRISE FIX: Legacy Migration Phase 4 - Formulation Engine - 2026-02-27
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { create } from 'zustand';
import {
  Beaker,
  CheckSquare,
  Edit3,
  Plus,
  RefreshCcw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
} from 'lucide-react';
import { toast } from '@services/toastService';
import apiClient from '@api/client';
import { getItems, type ItemDto } from '@services/itemsService';
import { usePermissions } from '@hooks/usePermissions';
import FormulationForm, {
  type FormulationDraft,
  type FormulationIngredient,
} from '@/components/FormulationForm';
import type { Item } from '../types';

type FormulationRecord = FormulationDraft & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

type FormulationStoreState = {
  items: Item[];
  formulations: FormulationRecord[];
  loading: boolean;
  error: string | null;
  isSubmitting: boolean;
  loadData: () => Promise<void>;
  saveFormula: (draft: FormulationDraft) => Promise<FormulationRecord>;
  deleteFormulas: (ids: string[]) => Promise<number>;
};

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
  category: row.category || ' 99',
  unit: row.unit || '"',
  minLimit: toNumber(row.minLimit, 0),
  maxLimit: toNumber(row.maxLimit, 1000),
  orderLimit: row.orderLimit == null ? undefined : toNumber(row.orderLimit, 0),
  currentStock: toNumber(row.currentStock, 0),
  lastUpdated: new Date().toISOString(),
});

const toApiPayload = (row: FormulationRecord | FormulationDraft) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  targetItemId: row.targetItemId,
  targetProductId: row.targetItemId,
  batchSizeTons: toNumber(row.batchSizeTons, 1),
  isActive: Boolean(row.isActive),
  notes: row.notes || '',
  ingredients: (row.ingredients || []).map((ingredient) => ({
    id: ingredient.id,
    itemId: ingredient.itemId,
    percentage: toNumber(ingredient.percentage, 0),
    weightPerTon: toNumber(ingredient.weightPerTon, 0),
  })),
  items: (row.ingredients || []).map((ingredient) => ({
    itemId: ingredient.itemId,
    percentage: toNumber(ingredient.percentage, 0),
    weightPerTon: toNumber(ingredient.weightPerTon, 0),
  })),
});

const normalizeIngredient = (raw: any): FormulationIngredient => ({
  id: String(raw?.id || crypto.randomUUID()),
  itemId: String(raw?.itemId || ''),
  percentage: toNumber(raw?.percentage, 0),
  weightPerTon: toNumber(raw?.weightPerTon, toNumber(raw?.percentage, 0) * 10),
});

const normalizeFormulationRow = (raw: any): FormulationRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const ingredientSource = Array.isArray(raw.ingredients)
    ? raw.ingredients
    : Array.isArray(raw.items)
      ? raw.items
      : [];

  const ingredients = ingredientSource
    .map(normalizeIngredient)
    .filter((row) => row.itemId && row.percentage > 0);

  const id = String(raw.id || crypto.randomUUID());
  const now = new Date().toISOString();
  return {
    id,
    code: String(raw.code || `FORM-${id.slice(0, 6).toUpperCase()}`),
    name: String(raw.name || ''),
    targetItemId: String(raw.targetItemId || raw.targetProductId || ''),
    batchSizeTons: Math.max(0.001, toNumber(raw.batchSizeTons, 1)),
    isActive: raw.isActive !== false,
    notes: raw.notes ? String(raw.notes) : undefined,
    ingredients,
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
  };
};

const fetchFormulations = async (): Promise<FormulationRecord[]> => {
  const response = await apiClient.get('/formulations');
  const payload = response.data;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return rows.map(normalizeFormulationRow).filter(Boolean) as FormulationRecord[];
};

const upsertFormulaInApi = async (
  row: FormulationRecord,
  mode: 'create' | 'edit',
): Promise<FormulationRecord> => {
  const response =
    mode === 'create'
      ? await apiClient.post('/formulations', toApiPayload(row))
      : await apiClient.put(`/formulations/${encodeURIComponent(String(row.id))}`, toApiPayload(row));
  return normalizeFormulationRow(response.data) || row;
};

const deleteFormulasInApi = async (ids: string[]): Promise<number> => {
  const response = await apiClient.post('/formulations/delete', { ids });
  return Number(response.data?.deleted ?? ids.length);
};

const useInventoryStore = create<FormulationStoreState>((set, get) => ({
  items: [],
  formulations: [],
  loading: false,
  error: null,
  isSubmitting: false,

  loadData: async () => {
    set({ loading: true, error: null });
    try {
      const [itemsData, formulationsData] = await Promise.all([
        getItems(),
        fetchFormulations(),
      ]);

      set({
        items: itemsData.map(mapItemDtoToItem),
        formulations: formulationsData,
        loading: false,
      });
    } catch (error: any) {
      set({
        loading: false,
        error: error?.response?.data?.message || error?.message || 'Failed to load formulations.',
      });
    }
  },

  saveFormula: async (draft) => {
    set({ isSubmitting: true });
    try {
      const now = new Date().toISOString();
      const existed = draft.id
        ? get().formulations.find((row) => String(row.id) === String(draft.id))
        : undefined;
      const id = String(draft.id || crypto.randomUUID());

      const normalized: FormulationRecord = {
        id,
        code: draft.code.trim() || `FORM-${Date.now().toString().slice(-6)}`,
        name: draft.name.trim(),
        targetItemId: String(draft.targetItemId),
        batchSizeTons: Math.max(0.001, toNumber(draft.batchSizeTons, 1)),
        isActive: Boolean(draft.isActive),
        notes: draft.notes?.trim() || undefined,
        ingredients: draft.ingredients.map((row) => ({
          ...row,
          percentage: Number(toNumber(row.percentage, 0).toFixed(3)),
          weightPerTon: Number(toNumber(row.weightPerTon, toNumber(row.percentage, 0) * 10).toFixed(3)),
        })),
        createdAt: existed?.createdAt || now,
        updatedAt: now,
      };

      const mode: 'create' | 'edit' = existed ? 'edit' : 'create';
      const saved = await upsertFormulaInApi(normalized, mode);

      set((state) => {
        const next = existed
          ? state.formulations.map((row) => (String(row.id) === String(saved.id) ? saved : row))
          : [saved, ...state.formulations];
        return { formulations: next };
      });

      return saved;
    } finally {
      set({ isSubmitting: false });
    }
  },

  deleteFormulas: async (ids) => {
    const uniqueIds = Array.from(new Set(ids.map(String)));
    if (!uniqueIds.length) return 0;
    const deleted = await deleteFormulasInApi(uniqueIds);
    set((state) => {
      const next = state.formulations.filter((row) => !uniqueIds.includes(String(row.id)));
      return { formulations: next };
    });
    return deleted;
  },
}));

const FormulationPage: React.FC = () => {
  const { hasPermission } = usePermissions();
  const {
    items,
    formulations,
    loading,
    error,
    isSubmitting,
    loadData,
    saveFormula,
    deleteFormulas,
  } = useInventoryStore();

  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<FormulationRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [focusFormulaId, setFocusFormulaId] = useState<string>('');

  const canView =
    hasPermission('*') ||
    hasPermission('formulation.view') ||
    hasPermission('inventory.view.stock');
  const canEdit =
    hasPermission('*') ||
    hasPermission('formulation.create') ||
    hasPermission('formulation.update') ||
    hasPermission('items.sync');
  const canDelete = hasPermission('*') || hasPermission('formulation.delete');

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const targetNameById = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => map.set(String(item.id), item.name));
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return formulations.filter((row) => {
      if (targetFilter !== 'all' && String(row.targetItemId) !== String(targetFilter)) return false;
      if (statusFilter === 'active' && !row.isActive) return false;
      if (statusFilter === 'inactive' && row.isActive) return false;
      if (!q) return true;
      return (
        String(row.name).toLowerCase().includes(q) ||
        String(row.code).toLowerCase().includes(q) ||
        String(targetNameById.get(String(row.targetItemId)) || '').toLowerCase().includes(q)
      );
    });
  }, [formulations, targetFilter, statusFilter, search, targetNameById]);

  useEffect(() => {
    if (!filtered.length) {
      setFocusFormulaId('');
      return;
    }
    if (!focusFormulaId || !filtered.some((row) => String(row.id) === String(focusFormulaId))) {
      setFocusFormulaId(String(filtered[0].id));
    }
  }, [filtered, focusFormulaId]);

  const selectAllChecked =
    filtered.length > 0 && filtered.every((row) => selectedIds.has(String(row.id)));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selectAllChecked) {
        filtered.forEach((row) => next.delete(String(row.id)));
      } else {
        filtered.forEach((row) => next.add(String(row.id)));
      }
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

  const selectedFormula = useMemo(
    () => formulations.find((row) => String(row.id) === String(focusFormulaId)) || null,
    [formulations, focusFormulaId],
  );

  const consumptionRows = useMemo(() => {
    if (!selectedFormula) return [];
    return selectedFormula.ingredients.map((ingredient) => {
      const item = items.find((row) => String(row.id) === String(ingredient.itemId));
      const requiredKg = toNumber(ingredient.weightPerTon, 0) * toNumber(selectedFormula.batchSizeTons, 0);
      const available = toNumber(item?.currentStock, 0);
      const remaining = available - requiredKg;
      return {
        id: ingredient.id,
        name: item?.name || ingredient.itemId,
        unit: item?.unit || '"',
        percentage: ingredient.percentage,
        requiredKg,
        available,
        remaining,
      };
    });
  }, [selectedFormula, items]);

  const onOpenCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const onOpenEdit = (row: FormulationRecord) => {
    setEditing(row);
    setFormOpen(true);
  };

  const onSaveFormula = async (draft: FormulationDraft) => {
    const saved = await saveFormula(editing ? { ...draft, id: editing.id } : draft);
    toast.success(editing ? '97"7"7"  9"#
" 9.' : '97"7"7" 9 9"#
" 9.');
    setFormOpen(false);
    setEditing(null);
    setFocusFormulaId(String(saved.id));
  };

  const onDeleteSelected = async () => {
    if (!canDelete) {
      toast.error('9 99"#
" 9  9"#
".');
      return;
    }
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const confirmed = window.confirm(` ${ids.length} "#
"#7:`);
    if (!confirmed) return;

    try {
      const deleted = await deleteFormulas(ids);
      setSelectedIds(new Set());
      toast.success(`97"7"7"  ${deleted} "#
".`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || '97"7"#" 9"#
".');
    }
  };

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <div className="mb-2 flex items-center gap-2 text-base font-bold">
          <ShieldAlert size={18} />
          <span> 9 9"#
"   9"#
"</span>
        </div>
        <p className="text-sm">
           9 <code>formulation.view</code> " 9 SuperAdmin.
        </p>
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
            <h1 className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              <Beaker size={20} />
              Formulation Engine
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
               "#
" 99 9  997"7"#9 999"#
" 99" 997"7"7".
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCcw size={15} />
              
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onOpenCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <Plus size={15} />
                 "#
"
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_180px]">
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="" 997"7"7" " 9"#
""..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <select
            value={targetFilter}
            onChange={(event) => setTargetFilter(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">"#
"#97"7"#"999 999</option>
            {items.map((item) => (
              <option key={String(item.id)} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="all">"#
"#97"7"#"99</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              99 9"#
": <strong>{filtered.length}</strong>
            </p>
            <button
              type="button"
              onClick={() => void onDeleteSelected()}
              disabled={!selectedIds.size || !canDelete}
              className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              <Trash2 size={14} />
               9 ({selectedIds.size})
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
                  <th className="px-3 py-2 text-right">9"#
""</th>
                  <th className="px-3 py-2 text-right">97"7"7" 9"#
"</th>
                  <th className="px-3 py-2 text-right">999 999</th>
                  <th className="px-3 py-2 text-right">99"#
""#9</th>
                  <th className="px-3 py-2 text-right">Batch (97"7"7")</th>
                  <th className="px-3 py-2 text-right">99</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                       997"7"#"9"#
"...
                    </td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-red-600">{error}</td>
                  </tr>
                )}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      9 " "#
" 997"7"#9 999 99.
                    </td>
                  </tr>
                )}
                {!loading && !error && filtered.map((row) => {
                  const id = String(row.id);
                  const totalPercentage = row.ingredients.reduce((sum, item) => sum + toNumber(item.percentage, 0), 0);
                  const focused = String(focusFormulaId) === id;
                  return (
                    <tr
                      key={id}
                      className={`border-t border-slate-200 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40 ${
                        focused ? 'bg-slate-50 dark:bg-slate-800/40' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => toggleSelectOne(id)}>
                          {selectedIds.has(id) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>
                      <td
                        className="cursor-pointer px-3 py-2 font-mono text-xs"
                        onClick={() => setFocusFormulaId(id)}
                      >
                        {row.code}
                      </td>
                      <td
                        className="cursor-pointer px-3 py-2 font-semibold text-slate-900 dark:text-slate-100"
                        onClick={() => setFocusFormulaId(id)}
                      >
                        {row.name}
                      </td>
                      <td className="px-3 py-2">{targetNameById.get(String(row.targetItemId)) || '-'}</td>
                      <td className="px-3 py-2">
                        {row.ingredients.length} ({totalPercentage.toFixed(2)}%)
                      </td>
                      <td className="px-3 py-2">{toNumber(row.batchSizeTons, 1).toFixed(3)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            row.isActive
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {row.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => onOpenEdit(row)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Edit3 size={13} />
                            97"7"#"7
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-2 text-base font-bold text-slate-900 dark:text-slate-100">
             99"#
" 99" 997"7"7"
          </h3>
          {!selectedFormula && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
               "#
" 997"7"7" 9"#97"7"#"9 999"#
" 99"#97"7"#9.
            </p>
          )}
          {selectedFormula && (
            <>
              <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedFormula.name}</p>
                <p className="text-slate-500 dark:text-slate-400">
                  Batch Size: {toNumber(selectedFormula.batchSizeTons, 1).toFixed(3)} 97"7"7"
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-right">99</th>
                      <th className="px-3 py-2 text-right">99</th>
                      <th className="px-3 py-2 text-right">99" ("#
"#97"7"7")</th>
                      <th className="px-3 py-2 text-right">9</th>
                      <th className="px-3 py-2 text-right">997"7"#9</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumptionRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2">{toNumber(row.percentage, 0).toFixed(2)}%</td>
                        <td className="px-3 py-2">{row.requiredKg.toFixed(3)}</td>
                        <td className="px-3 py-2">{row.available.toFixed(3)}</td>
                        <td className={`px-3 py-2 font-semibold ${row.remaining < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {row.remaining.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </aside>
      </div>

      <FormulationForm
        isOpen={formOpen}
        mode={editing ? 'edit' : 'create'}
        items={items}
        initialValue={editing}
        isSubmitting={isSubmitting}
        onSubmit={onSaveFormula}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
    </motion.section>
  );
};

export default FormulationPage;

