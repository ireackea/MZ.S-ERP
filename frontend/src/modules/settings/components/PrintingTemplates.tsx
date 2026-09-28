// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useState } from 'react';
import { Save, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { toast } from '@services/toastService';
import type { ReportColumnConfig } from '../../../types';
import { OPENING_BALANCE_COLUMNS, STOCK_CARD_COLUMNS, mergeColumns } from '@services/reportColumns';

interface PrintingTemplatesProps {
  reportConfig: ReportColumnConfig[];
  onUpdateReportConfig: (config: ReportColumnConfig[]) => void;
  openingBalanceReportConfig: ReportColumnConfig[];
  onUpdateOpeningBalanceReportConfig: (config: ReportColumnConfig[]) => void;
}

const PrintingTemplates: React.FC<PrintingTemplatesProps> = ({
  reportConfig,
  onUpdateReportConfig,
  openingBalanceReportConfig,
  onUpdateOpeningBalanceReportConfig,
  }) => {
  const { hasPermission } = usePermissions();
  /**
   * Gate 3.5 - both lists are seeded from the shared catalogue.
   *
   * They used to be seeded from the store, which holds `[]`, so both rendered zero
   * rows: there were no checkboxes to tick, and the Save button reported success
   * while writing an empty list back. `getReportConfig()` in storage.ts existed to
   * hydrate it and had no call sites.
   *
   * `mergeColumns` folds any stored selection onto the catalogue, so a column added
   * to a report later appears with its default instead of vanishing from the list,
   * and a key from an older release cannot linger as a row the report never renders.
   */
  const [localReports, setLocalReports] = useState<ReportColumnConfig[]>(() =>
    mergeColumns(STOCK_CARD_COLUMNS, reportConfig),
  );
  const [localOpening, setLocalOpening] = useState<ReportColumnConfig[]>(() =>
    mergeColumns(OPENING_BALANCE_COLUMNS, openingBalanceReportConfig),
  );

  useEffect(() => setLocalReports(mergeColumns(STOCK_CARD_COLUMNS, reportConfig)), [reportConfig]);
  useEffect(
    () => setLocalOpening(mergeColumns(OPENING_BALANCE_COLUMNS, openingBalanceReportConfig)),
    [openingBalanceReportConfig],
  );

  if (!hasPermission('settings.update.system')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية تعديل قوالب الطباعة</div>
        <div>تحتاج إلى الصلاحية <code>settings.update.system</code>.</div>
      </div>
    );
  }

  const toggle = (setter: React.Dispatch<React.SetStateAction<ReportColumnConfig[]>>, key: string) => {
    setter((current) => current.map((entry) => entry.key === key ? { ...entry, isVisible: !entry.isVisible } : entry));
  };

  const save = () => {
    onUpdateReportConfig(localReports);
    onUpdateOpeningBalanceReportConfig(localOpening);
    toast.success('تم حفظ إعدادات قوالب الطباعة بنجاح.');
  };

  return (
    <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-2xl font-black text-slate-900">قوالب الطباعة</h2>
        <p className="mt-2 text-sm text-slate-500">تحكم في الأعمدة الظاهرة في تقارير الطباعة الخاصة بالتقارير العامة وأرصدة الافتتاحية.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 font-bold text-slate-900">تقرير التقارير العامة</div>
          <div className="space-y-2">
            {localReports.map((column) => (
              <label key={column.key} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm">
                <span>{column.label}</span>
                <input type="checkbox" checked={column.isVisible} onChange={() => toggle(setLocalReports, column.key)} />
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 font-bold text-slate-900">تقرير الأرصدة الافتتاحية</div>
          <div className="space-y-2">
            {localOpening.map((column) => (
              <label key={column.key} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm">
                <span>{column.label}</span>
                <input type="checkbox" checked={column.isVisible} onChange={() => toggle(setLocalOpening, column.key)} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={save} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"><Save size={16} /> حفظ القوالب</button>
      </div>
    </div>
  );
};

export default PrintingTemplates;