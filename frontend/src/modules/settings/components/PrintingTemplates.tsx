// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useMemo, useState } from 'react';
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
  /** Gate 4.10 - reported so a tab switch asks instead of silently unmounting edits. */
  onDirtyChange?: (dirty: boolean) => void;
}

const PrintingTemplates: React.FC<PrintingTemplatesProps> = ({
  reportConfig,
  onUpdateReportConfig,
  openingBalanceReportConfig,
  onUpdateOpeningBalanceReportConfig,
  onDirtyChange,
  }) => {
  const { hasPermission } = usePermissions();
  /**
   * Gate 4.6 - may this session change which columns print.
   *
   * The tab that carries this panel is visible on `settings.view.general`, and the
   * panel used to gate itself on `settings.update.system`. So a holder of exactly
   * the tab's permission opened a tab that could only show them a red wall saying
   * no. Every other panel in this section renders itself read-only for a viewer,
   * which is what this does now: the columns are there to read, and inert to edit.
   */
  const canEditColumns = hasPermission('settings.update.system');
  /**
   * Gate 4.5 — the save writes where the reports read from.
   *
   * `save()` called two store setters and a toast. The setters wrote to state only,
   * and the store initialises `reportConfig` to `[]`, so the selection was gone on
   * the next load — and `Reports.tsx`, which sends the visible columns to the
   * server, held `[]` and got its request refused. The toast said "saved
   * successfully" over both.
   *
   * The `save*` helpers persist, and the setters that now persist too, so this is a
   * single write path rather than two. The props remain the store's current value,
   * which is what the rest of the app renders from.
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

  // Gate 4.10 - the unsaved-changes guard for a panel that previously had none at
  // all: it held its edits in local state, and a tab switch unmounted it. Only one of
  // the two lists differing from what was loaded counts, because saving writes both.
  const dirty = useMemo(
    () =>
      localReports.some((column) => {
        const loaded = reportConfig.find((entry) => entry.key === column.key);
        return loaded ? loaded.isVisible !== column.isVisible : true;
      })
      || localOpening.some((column) => {
        const loaded = openingBalanceReportConfig.find((entry) => entry.key === column.key);
        return loaded ? loaded.isVisible !== column.isVisible : true;
      }),
    [localReports, localOpening, reportConfig, openingBalanceReportConfig],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
                <input type="checkbox" checked={column.isVisible} disabled={!canEditColumns} onChange={() => toggle(setLocalReports, column.key)} />
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
                <input type="checkbox" checked={column.isVisible} disabled={!canEditColumns} onChange={() => toggle(setLocalOpening, column.key)} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={!canEditColumns} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"><Save size={16} /> حفظ القوالب</button>
      </div>
    </div>
  );
};

export default PrintingTemplates;