import React, { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '@api/client';
import { Info, Pencil, Plus, Save, ShieldAlert, Trash2, Truck } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../../../store/useInventoryStore';
import type { UnloadingRule, UnloadingRuleDraft } from '../../../types';

interface UnloadingRulesPanelProps {
}

const createEmptyDraft = (): UnloadingRuleDraft => ({
  rule_name: '',
  allowed_duration_minutes: 60,
  penalty_rate_per_minute: 0,
  is_active: true,
});

const UnloadingRulesPanel: React.FC<UnloadingRulesPanelProps> = ({ }) => {
  const { hasPermission } = usePermissions();
  const unloadingRules = useInventoryStore((state) => state.unloadingRules);
  const transactions = useInventoryStore((state) => state.transactions);
  const createUnloadingRule = useInventoryStore((state) => state.createUnloadingRule);
  const updateUnloadingRule = useInventoryStore((state) => state.updateUnloadingRule);
  const deleteUnloadingRule = useInventoryStore((state) => state.deleteUnloadingRule);

  const canView = hasPermission('settings.view.general');
  const canEdit = hasPermission('settings.update.system');
  const [draft, setDraft] = useState<UnloadingRuleDraft>(createEmptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  // Gate 4.3 - the count comes from the database, not from the client store.
  //
  // It used to be derived from `state.transactions`, which the store loads with no
  // pagination (the server's default page is 500). Past that, a rule that was
  // genuinely referenced showed "not in use", its Delete button was enabled, and
  // the panel printed a figure the operator used to justify deleting something —
  // while a banner above it promised the opposite.
  //
  // Until the server answers, the count is unknown rather than zero. Zero is a
  // claim, and a wrong zero enables a button.
  const [serverUsage, setServerUsage] = useState<Record<string, number> | null>(null);
  const usageRequestedRef = useRef(false);

  useEffect(() => {
    if (usageRequestedRef.current || !canView) return;
    usageRequestedRef.current = true;
    void apiClient
      .get('/unloading-rules/usage-counts')
      .then((response) => {
        setServerUsage(response.data && typeof response.data === 'object' ? (response.data as any) : {});
      })
      .catch(() => {
        // Left null so the delete path refuses rather than guessing. The server
        // re-checks on delete regardless; this is about the gate being honest.
        setServerUsage({});
      });
  }, [canView]);

  const usageByRuleId = useMemo(() => {
    const map = new Map<string, number>();
    if (serverUsage) {
      for (const [id, count] of Object.entries(serverUsage)) {
        map.set(String(id), Number(count) || 0);
      }
      return map;
    }
    // Fallback only while the server has not answered. The delete guard below
    // treats an absent entry as "unknown", so this cannot enable a delete.
    for (const transaction of transactions) {
      const key = String(transaction.unloadingRuleId || '').trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [transactions, serverUsage]);

  const resetForm = () => {
    setDraft(createEmptyDraft());
    setEditingId(null);
  };

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض قواعد التفريغ</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.general</code>.</div>
      </div>
    );
  }

  const validateDraft = () => {
    const ruleName = String(draft.rule_name || '').trim();
    const allowedDuration = Number(draft.allowed_duration_minutes || 0);
    const penaltyRate = Number(draft.penalty_rate_per_minute || 0);

    if (!ruleName) {
      toast.error('أدخل اسم قاعدة التفريغ أولاً.');
      return null;
    }

    if (!Number.isFinite(allowedDuration) || allowedDuration <= 0) {
      toast.error('مدة السماح يجب أن تكون رقمًا موجبًا.');
      return null;
    }

    if (!Number.isFinite(penaltyRate) || penaltyRate < 0) {
      toast.error('معدل الغرامة يجب أن يكون صفرًا أو رقمًا موجبًا.');
      return null;
    }

    return {
      rule_name: ruleName,
      allowed_duration_minutes: Math.trunc(allowedDuration),
      penalty_rate_per_minute: penaltyRate,
      is_active: draft.is_active ?? true,
    } satisfies UnloadingRuleDraft;
  };

  const handleSubmit = async () => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل قواعد التفريغ.');
      return;
    }

    const payload = validateDraft();
    if (!payload) return;

    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateUnloadingRule({ id: editingId, ...payload });
        toast.success('تم تحديث قاعدة التفريغ بنجاح.');
      } else {
        await createUnloadingRule(payload);
        toast.success('تمت إضافة قاعدة التفريغ بنجاح.');
      }
      resetForm();
    } catch (error: any) {
      toast.error(error?.message || 'تعذر حفظ قاعدة التفريغ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (rule: UnloadingRule) => {
    setEditingId(String(rule.id));
    setDraft({
      rule_name: String(rule.rule_name || ''),
      allowed_duration_minutes: Number(rule.allowed_duration_minutes || 0),
      penalty_rate_per_minute: Number(rule.penalty_rate_per_minute || 0),
      is_active: rule.is_active ?? true,
    });
  };

  const handleToggleActive = async (rule: UnloadingRule) => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل قواعد التفريغ.');
      return;
    }

    setBusyRuleId(String(rule.id));
    try {
      await updateUnloadingRule({
        ...rule,
        rule_name: String(rule.rule_name || ''),
        allowed_duration_minutes: Number(rule.allowed_duration_minutes || 0),
        penalty_rate_per_minute: Number(rule.penalty_rate_per_minute || 0),
        is_active: !(rule.is_active ?? true),
      });
      toast.success((rule.is_active ?? true) ? 'تم تعطيل القاعدة.' : 'تم تفعيل القاعدة.');
    } catch (error: any) {
      toast.error(error?.message || 'تعذر تحديث حالة قاعدة التفريغ.');
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleDelete = async (rule: UnloadingRule) => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل قواعد التفريغ.');
      return;
    }

    // `|| 0` claimed a rule was unused when the count was merely absent. A count
    // that has not arrived is not a zero, and a zero is what enables this button.
    const reported = usageByRuleId.get(String(rule.id));
    if (reported === undefined) {
      toast.error('لم يتم تحميل عدد الحركات المرتبطة بعد. أعد المحاولة قبل الحذف.');
      return;
    }
    const usage = reported;
    if (usage > 0) {
      toast.error(`لا يمكن حذف هذه القاعدة لأنها مستخدمة في ${usage} حركة. يمكنك تعطيلها بدلًا من حذفها.`);
      return;
    }

    if (!window.confirm(`هل تريد حذف قاعدة التفريغ "${rule.rule_name || ''}"؟`)) {
      return;
    }

    setBusyRuleId(String(rule.id));
    try {
      await deleteUnloadingRule(String(rule.id));
      toast.success('تم حذف قاعدة التفريغ بنجاح.');
      if (editingId === String(rule.id)) {
        resetForm();
      }
    } catch (error: any) {
      toast.error(error?.message || 'تعذر حذف قاعدة التفريغ.');
    } finally {
      setBusyRuleId(null);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-900">
            <Truck size={18} className="text-orange-600" />
            <h3 className="text-lg font-black">قواعد التفريغ</h3>
          </div>
          <p className="mt-2 text-sm text-slate-500">إدارة المعايير الزمنية وغرامات التأخير المستخدمة في شاشة العمليات والاستيراد والتقارير.</p>
        </div>
        <button
          type="button"
          onClick={resetForm}
          disabled={!canEdit}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          <Plus size={16} /> قاعدة جديدة
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0" /><span>الحذف محجوب لأي قاعدة مستخدمة في حركات سابقة، حتى لا تتكسر المراجع التاريخية في العمليات والتقارير.</span></div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
        <div className="space-y-3">
          {unloadingRules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">لا توجد قواعد تفريغ مسجلة حاليًا.</div>
          ) : (
            unloadingRules.map((rule) => {
              const shownUsage = usageByRuleId.get(String(rule.id));
              const usage = shownUsage === undefined ? 0 : shownUsage;
              const isBusy = busyRuleId === String(rule.id);
              return (
                <div key={rule.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-black text-slate-900">{rule.rule_name}</div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                          {rule.is_active ? 'نشطة' : 'معطلة'}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                        <div>مدة السماح: <span className="font-bold text-slate-900">{rule.allowed_duration_minutes}</span> دقيقة</div>
                        <div>الغرامة: <span className="font-bold text-slate-900">{rule.penalty_rate_per_minute}</span> د.ل/دقيقة</div>
                        <div>مرتبطة بـ <span className="font-bold text-slate-900">{usage}</span> حركة</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(rule)}
                        disabled={!canEdit || isBusy}
                        className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-40"
                      >
                        {rule.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(rule)}
                        disabled={!canEdit || isBusy}
                        className="inline-flex items-center gap-2 rounded-2xl border border-blue-300 px-3 py-2 text-sm font-bold text-blue-700 disabled:opacity-40"
                      >
                        <Pencil size={14} /> تعديل
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(rule)}
                        disabled={!canEdit || isBusy || usage > 0}
                        className="inline-flex items-center gap-2 rounded-2xl border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={14} /> حذف
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-4">
            <h4 className="text-base font-black text-slate-900">{editingId ? 'تعديل قاعدة التفريغ' : 'إضافة قاعدة تفريغ'}</h4>
            <p className="mt-1 text-sm text-slate-500">أدخل اسم القاعدة ومدة السماح ومعدل الغرامة.</p>
          </div>

          <div className="space-y-4">
            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              <span>اسم القاعدة</span>
              <input
                type="text"
                value={draft.rule_name}
                onChange={(event) => setDraft((current) => ({ ...current, rule_name: event.target.value }))}
                disabled={!canEdit || isSubmitting}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                placeholder="مثال: تفريغ سريع"
              />
            </label>

            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              <span>مدة السماح بالدقائق</span>
              <input
                type="number"
                min="1"
                value={draft.allowed_duration_minutes}
                onChange={(event) => setDraft((current) => ({ ...current, allowed_duration_minutes: Number(event.target.value || 0) }))}
                disabled={!canEdit || isSubmitting}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>

            <label className="block space-y-2 text-sm font-semibold text-slate-700">
              <span>معدل الغرامة لكل دقيقة</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.penalty_rate_per_minute}
                onChange={(event) => setDraft((current) => ({ ...current, penalty_rate_per_minute: Number(event.target.value || 0) }))}
                disabled={!canEdit || isSubmitting}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
              />
            </label>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={draft.is_active ?? true}
                onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                disabled={!canEdit || isSubmitting}
                className="h-4 w-4"
              />
              القاعدة نشطة ومتاحة للاختيار داخل العمليات
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canEdit || isSubmitting}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {editingId ? <Save size={16} /> : <Plus size={16} />}
              {editingId ? 'حفظ التعديلات' : 'إضافة القاعدة'}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                disabled={isSubmitting}
                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-60"
              >
                إلغاء
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};

export default UnloadingRulesPanel;