import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Beaker, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from '@services/toastService';
import type { Item } from '../types';

export type FormulationIngredient = {
  id: string;
  itemId: string;
  percentage: number;
  weightPerTon: number;
};

export type FormulationDraft = {
  id?: string;
  code: string;
  name: string;
  targetItemId: string;
  batchSizeTons: number;
  isActive: boolean;
  notes?: string;
  ingredients: FormulationIngredient[];
};

interface FormulationFormProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  items: Item[];
  initialValue?: Partial<FormulationDraft> | null;
  isSubmitting?: boolean;
  onSubmit: (draft: FormulationDraft) => void | Promise<void>;
  onClose: () => void;
}

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createEmptyDraft = (): FormulationDraft => ({
  code: '',
  name: '',
  targetItemId: '',
  batchSizeTons: 1,
  isActive: true,
  notes: '',
  ingredients: [],
});

const createIngredientId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `ingredient-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeIngredient = (row: Partial<FormulationIngredient>): FormulationIngredient => {
  const percentage = Math.max(0, toNumber(row.percentage, 0));

  return {
    id: String(row.id || createIngredientId()),
    itemId: String(row.itemId || ''),
    percentage,
    weightPerTon: Number(toNumber(row.weightPerTon, percentage * 10).toFixed(3)),
  };
};

const normalizeDraft = (value?: Partial<FormulationDraft> | null): FormulationDraft => {
  const base = createEmptyDraft();
  if (!value) return base;

  return {
    id: value.id ? String(value.id) : undefined,
    code: String(value.code || ''),
    name: String(value.name || ''),
    targetItemId: String(value.targetItemId || ''),
    batchSizeTons: Math.max(0.001, toNumber(value.batchSizeTons, 1)),
    isActive: value.isActive !== false,
    notes: String(value.notes || ''),
    ingredients: Array.isArray(value.ingredients)
      ? value.ingredients.map(normalizeIngredient).filter((row) => row.itemId)
      : [],
  };
};

const FormulationForm: React.FC<FormulationFormProps> = ({
  isOpen,
  mode,
  items,
  initialValue,
  isSubmitting = false,
  onSubmit,
  onClose,
}) => {
  const [draft, setDraft] = useState<FormulationDraft>(() => normalizeDraft(initialValue));
  const [rawItemId, setRawItemId] = useState('');
  const [rawPercentage, setRawPercentage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDraft(normalizeDraft(initialValue));
    setRawItemId('');
    setRawPercentage('');
  }, [initialValue, isOpen]);

  const totalPercentage = useMemo(
    () => draft.ingredients.reduce((sum, row) => sum + toNumber(row.percentage, 0), 0),
    [draft.ingredients],
  );

  const totalWeightPerTon = useMemo(
    () => draft.ingredients.reduce((sum, row) => sum + toNumber(row.weightPerTon, 0), 0),
    [draft.ingredients],
  );

  const canSave =
    draft.name.trim().length > 0 &&
    draft.targetItemId.trim().length > 0 &&
    draft.ingredients.length > 0 &&
    Math.abs(totalPercentage - 100) <= 0.001;

  const addIngredient = () => {
    const itemId = rawItemId.trim();
    const percentage = toNumber(rawPercentage, NaN);

    if (!itemId) {
      toast.error('يرجى اختيار مادة خام.');
      return;
    }

    if (!Number.isFinite(percentage) || percentage <= 0) {
      toast.error('يرجى إدخال نسبة صحيحة أكبر من صفر.');
      return;
    }

    if (draft.ingredients.some((row) => String(row.itemId) === String(itemId))) {
      toast.error('هذه المادة الخام مضافة بالفعل إلى التركيبة.');
      return;
    }

    if (totalPercentage + percentage > 100.001) {
      toast.error('مجموع نسب المكونات لا يمكن أن يتجاوز 100%.');
      return;
    }

    const ingredient: FormulationIngredient = {
      id: createIngredientId(),
      itemId,
      percentage,
      weightPerTon: Number((percentage * 10).toFixed(3)),
    };

    setDraft((prev) => ({ ...prev, ingredients: [...prev.ingredients, ingredient] }));
    setRawItemId('');
    setRawPercentage('');
  };

  const removeIngredient = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.filter((row) => String(row.id) !== String(id)),
    }));
  };

  const updateIngredientPercentage = (id: string, nextValue: string) => {
    const percentage = toNumber(nextValue, NaN);
    if (!Number.isFinite(percentage) || percentage <= 0) {
      return;
    }

    const othersTotal = draft.ingredients
      .filter((row) => String(row.id) !== String(id))
      .reduce((sum, row) => sum + toNumber(row.percentage, 0), 0);

    if (othersTotal + percentage > 100.001) {
      toast.error('مجموع نسب المكونات لا يمكن أن يتجاوز 100%.');
      return;
    }

    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((row) =>
        String(row.id) === String(id)
          ? {
              ...row,
              percentage,
              weightPerTon: Number((percentage * 10).toFixed(3)),
            }
          : row,
      ),
    }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!draft.name.trim()) {
      toast.error('يرجى إدخال اسم التركيبة.');
      return;
    }

    if (!draft.targetItemId.trim()) {
      toast.error('يرجى اختيار المنتج المستهدف.');
      return;
    }

    if (!draft.ingredients.length) {
      toast.error('أضف مكوّناً واحداً على الأقل قبل الحفظ.');
      return;
    }

    if (Math.abs(totalPercentage - 100) > 0.001) {
      toast.error(`يجب أن يساوي مجموع النسب 100%، والقيمة الحالية هي ${totalPercentage.toFixed(3)}%.`);
      return;
    }

    await onSubmit({
      ...draft,
      code: draft.code.trim(),
      name: draft.name.trim(),
      targetItemId: draft.targetItemId.trim(),
      batchSizeTons: Math.max(0.001, toNumber(draft.batchSizeTons, 1)),
      notes: draft.notes?.trim() || undefined,
      ingredients: draft.ingredients.map((row) => ({
        ...row,
        percentage: Number(toNumber(row.percentage, 0).toFixed(3)),
        weightPerTon: Number(toNumber(row.weightPerTon, 0).toFixed(3)),
      })),
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.form
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          onSubmit={handleSave}
          className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          aria-label={mode === 'create' ? 'Create formulation form' : 'Edit formulation form'}
          dir="rtl"
        >
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <h2 className="inline-flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
              <Beaker size={18} />
              {mode === 'create' ? 'إضافة تركيبة' : 'تعديل تركيبة'}
            </h2>
            <button
              type="button"
              aria-label="Close formulation form"
              onClick={onClose}
              className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">اسم التركيبة *</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                required
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">كود التركيبة</span>
              <input
                value={draft.code}
                onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value }))}
                placeholder="يُولد تلقائياً إذا تُرك فارغاً"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">المنتج المستهدف *</span>
              <select
                value={draft.targetItemId}
                onChange={(event) => setDraft((prev) => ({ ...prev, targetItemId: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                required
              >
                <option value="">اختر المنتج المستهدف</option>
                {items.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {item.name} ({item.unit})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">حجم الدفعة بالطن *</span>
              <input
                type="number"
                min={0.001}
                step="0.001"
                value={draft.batchSizeTons}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    batchSizeTons: Math.max(0.001, toNumber(event.target.value, 1)),
                  }))
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                required
              />
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">ملاحظات</span>
              <textarea
                rows={2}
                value={draft.notes || ''}
                onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>

            <label className="inline-flex items-center gap-3 md:col-span-2">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">تركيبة نشطة</span>
            </label>
          </div>

          <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-700">
            <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">مكوّنات التركيبة</h3>

            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_auto]">
              <select
                aria-label="Ingredient item"
                value={rawItemId}
                onChange={(event) => setRawItemId(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">اختر مادة خام</option>
                {items.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {item.name} ({toNumber(item.currentStock, 0).toLocaleString()} {item.unit})
                  </option>
                ))}
              </select>

              <input
                aria-label="Ingredient percentage"
                type="number"
                min={0.001}
                max={100}
                step="0.001"
                value={rawPercentage}
                onChange={(event) => setRawPercentage(event.target.value)}
                placeholder="النسبة %"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />

              <button
                type="button"
                onClick={addIngredient}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                <Plus size={14} />
                إضافة مكوّن
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-right">المادة الخام</th>
                    <th className="px-3 py-2 text-right">النسبة %</th>
                    <th className="px-3 py-2 text-right">الوزن لكل طن</th>
                    <th className="px-3 py-2 text-right">الاستهلاك للدفعة</th>
                    <th className="px-3 py-2 text-right">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.ingredients.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        لا توجد مكوّنات مضافة بعد.
                      </td>
                    </tr>
                  )}
                  {draft.ingredients.map((ingredient) => {
                    const item = items.find((row) => String(row.id) === String(ingredient.itemId));
                    const consumptionKg =
                      toNumber(ingredient.weightPerTon, 0) * toNumber(draft.batchSizeTons, 0);

                    return (
                      <tr key={ingredient.id} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {item?.name || ingredient.itemId}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            aria-label={`Ingredient percentage ${ingredient.id}`}
                            type="number"
                            min={0.001}
                            max={100}
                            step="0.001"
                            value={ingredient.percentage}
                            onChange={(event) =>
                              updateIngredientPercentage(ingredient.id, event.target.value)
                            }
                            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-3 py-2">{toNumber(ingredient.weightPerTon, 0).toFixed(3)}</td>
                        <td className="px-3 py-2">{consumptionKg.toFixed(3)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            aria-label="Remove ingredient"
                            onClick={() => removeIngredient(ingredient.id)}
                            className="rounded-lg border border-red-300 p-1.5 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-900 dark:text-slate-100">الإجمالي</td>
                    <td
                      className={`px-3 py-2 font-bold ${
                        Math.abs(totalPercentage - 100) <= 0.001 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {totalPercentage.toFixed(3)}%
                    </td>
                    <td className="px-3 py-2 font-bold">{totalWeightPerTon.toFixed(3)}</td>
                    <td className="px-3 py-2 font-bold">
                      {(totalWeightPerTon * toNumber(draft.batchSizeTons, 0)).toFixed(3)}
                    </td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <p className={`text-xs ${canSave ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
              {canSave
                ? 'البيانات جاهزة للحفظ ومجموع النسب يساوي 100%.'
                : 'أكمل البيانات المطلوبة وتأكد من أن مجموع نسب المكونات يساوي 100%.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={!canSave || isSubmitting}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                حفظ التركيبة
              </button>
            </div>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
};

export default FormulationForm;