import React, { useMemo, useRef, useState } from 'react';
import { Info, Package, Plus, Ruler, ShieldAlert, Trash2 } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../../../store/useInventoryStore';

interface ReferenceDataSettingsProps {
  forceAccess?: boolean;
}

const normalize = (value: string) => String(value || '').trim();

const ReferenceDataSettings: React.FC<ReferenceDataSettingsProps> = ({ forceAccess = false }) => {
  const { hasPermission } = usePermissions();
  const items = useInventoryStore((state) => state.items);
  const categories = useInventoryStore((state) => state.categories);
  const units = useInventoryStore((state) => state.units);
  const addCategory = useInventoryStore((state) => state.addCategory);
  const deleteCategory = useInventoryStore((state) => state.deleteCategory);
  const addUnit = useInventoryStore((state) => state.addUnit);
  const deleteUnit = useInventoryStore((state) => state.deleteUnit);

  const canView = forceAccess || hasPermission('settings.view.general');
  const canEdit = forceAccess || hasPermission('settings.update.system');
  const [newCategory, setNewCategory] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const categoryInputRef = useRef<HTMLInputElement | null>(null);
  const unitInputRef = useRef<HTMLInputElement | null>(null);

  const categoryUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = normalize(String(item.category || '')).toLowerCase();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [items]);

  const unitUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = normalize(String(item.unit || '')).toLowerCase();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [items]);

  const sortedCategories = useMemo(() => [...categories].sort((left, right) => left.localeCompare(right, 'ar')), [categories]);
  const sortedUnits = useMemo(() => [...units].sort((left, right) => left.localeCompare(right, 'ar')), [units]);

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض الأقسام ووحدات القياس</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.general</code>.</div>
      </div>
    );
  }

  const handleAddCategory = () => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const value = normalize(newCategory);
    if (!value) {
      toast.error('أدخل اسم القسم أولاً.');
      return;
    }

    const exists = categories.some((entry) => normalize(entry).toLowerCase() === value.toLowerCase());
    if (exists) {
      toast.warning('هذا القسم موجود بالفعل.');
      return;
    }

    addCategory(value);
    setNewCategory('');
    toast.success('تمت إضافة القسم بنجاح.');
    window.requestAnimationFrame(() => {
      categoryInputRef.current?.focus();
    });
  };

  const handleAddUnit = () => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const value = normalize(newUnit);
    if (!value) {
      toast.error('أدخل اسم وحدة القياس أولاً.');
      return;
    }

    const exists = units.some((entry) => normalize(entry).toLowerCase() === value.toLowerCase());
    if (exists) {
      toast.warning('وحدة القياس موجودة بالفعل.');
      return;
    }

    addUnit(value);
    setNewUnit('');
    toast.success('تمت إضافة وحدة القياس بنجاح.');
    window.requestAnimationFrame(() => {
      unitInputRef.current?.focus();
    });
  };

  const handleCategoryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleAddCategory();
  };

  const handleUnitKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleAddUnit();
  };

  const handleDeleteCategory = (category: string) => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const count = categoryUsage.get(normalize(category).toLowerCase()) || 0;
    if (count > 0) {
      toast.error(`لا يمكن حذف قسم مستخدم في ${count} صنف.`);
      return;
    }

    if (!window.confirm(`هل تريد حذف القسم "${category}"؟`)) return;
    deleteCategory(category);
    toast.success('تم حذف القسم بنجاح.');
  };

  const handleDeleteUnit = (unit: string) => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const count = unitUsage.get(normalize(unit).toLowerCase()) || 0;
    if (count > 0) {
      toast.error(`لا يمكن حذف وحدة مستخدمة في ${count} صنف.`);
      return;
    }

    if (!window.confirm(`هل تريد حذف وحدة القياس "${unit}"؟`)) return;
    deleteUnit(unit);
    toast.success('تم حذف وحدة القياس بنجاح.');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-slate-900 p-3 text-white">
            <Package size={22} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900">الأقسام ووحدات القياس</h2>
            <p className="mt-2 text-sm text-slate-500">مرجع موحد للقيم المستخدمة في شاشة الأصناف وباقي الشاشات التي تعتمد على التصنيف أو وحدة القياس.</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0" /><span>لا يمكن حذف أي قيمة مستخدمة فعليًا داخل الأصناف الحالية، حتى لا تتكسر المراجع المستخدمة في النظام.</span></div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-900">
            <Package size={18} className="text-emerald-600" />
            <h3 className="text-lg font-black">الأقسام</h3>
          </div>
          <div className="mb-4 flex gap-2">
            <input
              ref={categoryInputRef}
              type="text"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={handleCategoryKeyDown}
              placeholder="أدخل اسم القسم"
              disabled={!canEdit}
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              disabled={!canEdit}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <Plus size={16} /> إضافة
            </button>
          </div>
          <div className="space-y-3">
            {sortedCategories.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">لا توجد أقسام مسجلة حاليًا.</div>
            ) : (
              sortedCategories.map((category) => {
                const usage = categoryUsage.get(normalize(category).toLowerCase()) || 0;
                return (
                  <div key={category} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="font-bold text-slate-800">{category}</div>
                      <div className="mt-1 text-xs text-slate-500">{usage > 0 ? `مستخدم في ${usage} صنف` : 'غير مستخدم حاليًا'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(category)}
                      disabled={!canEdit || usage > 0}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={14} /> حذف
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-900">
            <Ruler size={18} className="text-blue-600" />
            <h3 className="text-lg font-black">وحدات القياس</h3>
          </div>
          <div className="mb-4 flex gap-2">
            <input
              ref={unitInputRef}
              type="text"
              value={newUnit}
              onChange={(event) => setNewUnit(event.target.value)}
              onKeyDown={handleUnitKeyDown}
              placeholder="أدخل اسم وحدة القياس"
              disabled={!canEdit}
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            />
            <button
              type="button"
              onClick={handleAddUnit}
              disabled={!canEdit}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <Plus size={16} /> إضافة
            </button>
          </div>
          <div className="space-y-3">
            {sortedUnits.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">لا توجد وحدات قياس مسجلة حاليًا.</div>
            ) : (
              sortedUnits.map((unit) => {
                const usage = unitUsage.get(normalize(unit).toLowerCase()) || 0;
                return (
                  <div key={unit} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="font-bold text-slate-800">{unit}</div>
                      <div className="mt-1 text-xs text-slate-500">{usage > 0 ? `مستخدمة في ${usage} صنف` : 'غير مستخدمة حاليًا'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteUnit(unit)}
                      disabled={!canEdit || usage > 0}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={14} /> حذف
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ReferenceDataSettings;