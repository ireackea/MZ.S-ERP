// ENTERPRISE FIX: Phase 3 - Full Legacy Removal & Complete Single Source of Truth - 2026-03-05
// ENTERPRISE FIX: Phase 2 - Full Single Source of Truth & Legacy Cleanup - 2026-03-05
// ENTERPRISE FIX: Phase 1 - Single Source of Truth & Integration - 2026-03-05
import React, { useEffect, useMemo, useState } from 'react';
import { Beaker, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from '@services/toastService';
import FormulationForm from './FormulationForm';
import type { Formula, Item } from '../types';
import { useInventoryStore } from '../store/useInventoryStore';

interface FormulationProps {
  formulas: Formula[];
  items?: Item[];
  onAddFormula: (formula: Formula) => void | Promise<void>;
  onUpdateFormula: (formula: Formula) => void | Promise<void>;
  onDeleteFormula: (id: string) => void | Promise<void>;
}

const percentageTotal = (formula: Formula) =>
  formula.items.reduce((sum, item) => sum + Number(item.percentage || 0), 0);

const Formulation: React.FC<FormulationProps> = ({
  formulas,
  items: itemsProp,
  onAddFormula,
  onUpdateFormula,
  onDeleteFormula,
}) => {
  const storeItems = useInventoryStore((state) => state.items);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
  const items = itemsProp && itemsProp.length > 0 ? itemsProp : storeItems;
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFormula, setEditingFormula] = useState<Formula | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!lastLoadedAt) {
      void loadAll();
    }
  }, [lastLoadedAt, loadAll]);

  const itemMap = useMemo(() => new Map(items.map((item) => [String(item.id), item])), [items]);

  const filteredFormulas = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return formulas;
    return formulas.filter((formula) => {
      const targetName = itemMap.get(String(formula.targetProductId))?.name || '';
      return (
        formula.name.toLowerCase().includes(query) ||
        formula.code.toLowerCase().includes(query) ||
        targetName.toLowerCase().includes(query)
      );
    });
  }, [formulas, itemMap, search]);

  const activeCount = formulas.filter((formula) => formula.isActive !== false).length;

  const openCreate = () => {
    setEditingFormula(null);
    setIsModalOpen(true);
  };

  const openEdit = (formula: Formula) => {
    setEditingFormula(formula);
    setIsModalOpen(true);
  };

  const handleSave = async (formula: Formula) => {
    setIsSubmitting(true);
    try {
      if (editingFormula) {
        await onUpdateFormula(formula);
        toast.success('تم تحديث التركيبة بنجاح.');
      } else {
        await onAddFormula(formula);
        toast.success('تمت إضافة التركيبة بنجاح.');
      }
      setIsModalOpen(false);
      setEditingFormula(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (formula: Formula) => {
    const confirmed = window.confirm(`سيتم حذف التركيبة "${formula.name}". هل تريد المتابعة؟`);
    if (!confirmed) return;
    await onDeleteFormula(formula.id);
    toast.success('تم حذف التركيبة.');
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-3xl bg-[linear-gradient(135deg,_#0f172a,_#14532d)] p-6 text-white shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
                <Beaker className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-3xl font-black">إدارة التركيبات</h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-200">
                  أنشئ وصفات الإنتاج وحدد نسب المكوّنات لكل منتج نهائي مع مراجعة سريعة لمجموع النسب والمكونات.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-emerald-50"
            >
              <Plus className="h-4 w-4" />
              إضافة تركيبة
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">إجمالي التركيبات</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{formulas.length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">التركيبات النشطة</p>
            <p className="mt-2 text-3xl font-black text-emerald-700">{activeCount}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">الأصناف المتاحة</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{items.length}</p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث باسم التركيبة أو الكود أو المنتج"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 pr-12 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
        </div>
      </div>

      {filteredFormulas.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
          <Beaker className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-4 text-xl font-black text-slate-800">لا توجد تركيبات مطابقة</h3>
          <p className="mt-2 text-sm text-slate-500">
            ابدأ بإضافة تركيبة جديدة أو عدّل نص البحث لإظهار النتائج المتاحة.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredFormulas.map((formula) => {
            const total = percentageTotal(formula);
            const targetItem = itemMap.get(String(formula.targetProductId));
            return (
              <div key={formula.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                      {formula.code}
                    </span>
                    <h3 className="text-2xl font-black text-slate-900">{formula.name}</h3>
                    <p className="text-sm text-slate-500">
                      المنتج المستهدف: <span className="font-semibold text-slate-800">{targetItem?.name || 'غير محدد'}</span>
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      formula.isActive !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {formula.isActive !== false ? 'نشطة' : 'غير نشطة'}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">عدد المكونات</p>
                    <p className="mt-2 text-xl font-black text-slate-900">{formula.items.length}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">إجمالي النسب</p>
                    <p
                      className={`mt-2 text-xl font-black ${
                        Math.abs(total - 100) <= 0.001 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {total.toFixed(3)}%
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500">الحالة</p>
                    <p className="mt-2 text-xl font-black text-slate-900">
                      {Math.abs(total - 100) <= 0.001 ? 'جاهزة' : 'تحتاج مراجعة'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  <p className="text-sm font-bold text-slate-700">المكونات</p>
                  <div className="flex flex-wrap gap-2">
                    {formula.items.map((ingredient) => (
                      <span
                        key={`${formula.id}-${ingredient.itemId}`}
                        className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                      >
                        {(itemMap.get(String(ingredient.itemId))?.name || 'غير معروف') + ` - ${ingredient.percentage}%`}
                      </span>
                    ))}
                  </div>
                </div>

                {formula.notes && (
                  <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                    {formula.notes}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={() => openEdit(formula)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    <Edit2 className="h-4 w-4" />
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(formula)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FormulationForm
        isOpen={isModalOpen}
        mode={editingFormula ? 'edit' : 'create'}
        items={items}
        initialValue={editingFormula as unknown as import('./FormulationForm').FormulationDraft}
        isSubmitting={isSubmitting}
        onSubmit={handleSave as unknown as (draft: import('./FormulationForm').FormulationDraft) => void | Promise<void>}
        onClose={() => {
          setIsModalOpen(false);
          setEditingFormula(null);
        }}
      />
    </div>
  );
};

export default Formulation;
