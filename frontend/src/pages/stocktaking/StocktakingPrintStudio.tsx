import React from 'react';
import { Printer } from 'lucide-react';
import {
  REPORT_CARD_CONFIG,
  type PrintPageMetrics,
  type StocktakingPrintConfig,
  type StocktakingPrintTab,
  type StocktakingPrintTemplate,
} from './shared';

type StocktakingPrintStudioProps = {
  open: boolean;
  onClose: () => void;
  printTemplateName: string;
  onPrintTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
  selectedTemplateId: string;
  printTemplates: StocktakingPrintTemplate[];
  onApplyTemplate: (templateId: string) => void;
  onDeleteTemplate: () => void;
  activePrintTab: StocktakingPrintTab;
  onActivePrintTabChange: (tab: StocktakingPrintTab) => void;
  printConfig: StocktakingPrintConfig;
  setPrintConfig: React.Dispatch<React.SetStateAction<StocktakingPrintConfig>>;
  printStatusMessage: string;
  printPageRef: React.RefObject<HTMLDivElement | null>;
  pageMetrics: PrintPageMetrics;
  preview: React.ReactNode;
  isPrintingPdf: boolean;
  onBuildPdf: () => void;
};

const StocktakingPrintStudio: React.FC<StocktakingPrintStudioProps> = ({
  open,
  onClose,
  printTemplateName,
  onPrintTemplateNameChange,
  onSaveTemplate,
  selectedTemplateId,
  printTemplates,
  onApplyTemplate,
  onDeleteTemplate,
  activePrintTab,
  onActivePrintTabChange,
  printConfig,
  setPrintConfig,
  printStatusMessage,
  printPageRef,
  pageMetrics,
  preview,
  isPrintingPdf,
  onBuildPdf,
}) => {
  if (!open) return null;

  const tabButtonClass = (tab: StocktakingPrintTab) =>
    `rounded-lg px-3 py-1.5 text-xs font-bold ${activePrintTab === tab ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600'}`;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm">
      <div className="flex h-full w-full flex-col bg-slate-100">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-slate-800">
              <Printer size={18} className="text-indigo-600" />
              استوديو الطباعة - إعداد الجرد
            </h3>
            <p className="text-xs text-slate-500">اضبط القالب قبل الطباعة أو الحفظ لتوليد نسخة معتمدة بصيغة مناسبة للأرشفة.</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={printTemplateName}
              onChange={(e) => onPrintTemplateNameChange(e.target.value)}
              placeholder="اسم القالب"
              title="اسم قالب الطباعة"
              className="min-w-48 rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <button onClick={onSaveTemplate} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs hover:bg-slate-50">حفظ القالب</button>
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
              value={selectedTemplateId}
              title="اختيار قالب محفوظ"
              onChange={(e) => onApplyTemplate(e.target.value)}
            >
              <option value="">اختر قالبًا محفوظًا...</option>
              {printTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <button onClick={onDeleteTemplate} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 hover:bg-red-100">حذف القالب</button>
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">إغلاق</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-12">
          <div className="col-span-3 overflow-y-auto border-r border-slate-200 bg-white">
            <div className="flex gap-2 border-b border-slate-200 bg-slate-50 p-3">
              <button onClick={() => onActivePrintTabChange('layout')} className={tabButtonClass('layout')}>التخطيط</button>
              <button onClick={() => onActivePrintTabChange('content')} className={tabButtonClass('content')}>المحتوى</button>
              <button onClick={() => onActivePrintTabChange('branding')} className={tabButtonClass('branding')}>الهوية</button>
            </div>

            <div className="space-y-4 p-4 text-xs">
              {activePrintTab === 'layout' && (
                <>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">عنوان التقرير</label>
                    <input
                      title="عنوان التقرير"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.reportTitle}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, reportTitle: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">اتجاه الصفحة</label>
                    <select
                      title="اتجاه الصفحة"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.orientation}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, orientation: e.target.value as StocktakingPrintConfig['orientation'] }))}
                    >
                      <option value="portrait">طولي</option>
                      <option value="landscape">عرضي</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">مقاس الورق</label>
                    <select
                      title="مقاس الورق"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.paperSize}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, paperSize: e.target.value as StocktakingPrintConfig['paperSize'] }))}
                    >
                      <option value="a4">A4</option>
                      <option value="a3">A3</option>
                      <option value="legal">Legal</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">الهوامش</label>
                    <select
                      title="الهوامش"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.margins}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, margins: e.target.value as StocktakingPrintConfig['margins'] }))}
                    >
                      <option value="narrow">ضيقة</option>
                      <option value="normal">متوسطة</option>
                      <option value="wide">واسعة</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">الهامش العلوي ({printConfig.topPageMarginMm}mm)</label>
                    <input
                      title="الهامش العلوي"
                      type="range"
                      min={0}
                      max={50}
                      value={printConfig.topPageMarginMm}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, topPageMarginMm: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">الهامش السفلي ({printConfig.bottomPageMarginMm}mm)</label>
                    <input
                      title="الهامش السفلي"
                      type="range"
                      min={0}
                      max={50}
                      value={printConfig.bottomPageMarginMm}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, bottomPageMarginMm: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                    <span>تقسيم صفحات ذكي</span>
                    <input
                      type="checkbox"
                      checked={printConfig.smartPaginationEnabled}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, smartPaginationEnabled: e.target.checked }))}
                    />
                  </label>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">حجم خط الترويسة ({printConfig.fontSize}px)</label>
                    <input
                      title="حجم خط الترويسة"
                      type="range"
                      min={9}
                      max={30}
                      value={printConfig.fontSize}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, fontSize: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">حجم خط الجدول ({printConfig.tableFontSize}px)</label>
                    <input
                      title="حجم خط الجدول"
                      type="range"
                      min={5}
                      max={25}
                      value={printConfig.tableFontSize}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, tableFontSize: Number(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                </>
              )}

              {activePrintTab === 'content' && (
                <>
                  <div>
                    <label className="mb-2 block font-bold text-slate-500">البطاقات الظاهرة</label>
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {REPORT_CARD_CONFIG.map((card) => (
                        <label key={card.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">
                          <span>{card.title}</span>
                          <input
                            type="checkbox"
                            checked={printConfig.selectedCards.includes(card.key)}
                            onChange={() => setPrintConfig((prev) => {
                              const exists = prev.selectedCards.includes(card.key);
                              const next = exists
                                ? prev.selectedCards.filter((key) => key !== card.key)
                                : [...prev.selectedCards, card.key];
                              return { ...prev, selectedCards: next.length ? next : [card.key] };
                            })}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                    <span>إظهار التوقيعات</span>
                    <input
                      type="checkbox"
                      checked={printConfig.showSignatures}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, showSignatures: e.target.checked }))}
                    />
                  </label>
                  {printConfig.showSignatures && (
                    <div>
                      <label className="mb-1 block font-bold text-slate-500">ارتفاع مربع التوقيع ({printConfig.printSignatureBoxHeight || 96}px)</label>
                      <input
                        title="ارتفاع مربع التوقيع"
                        type="range"
                        min={48}
                        max={180}
                        step={4}
                        value={printConfig.printSignatureBoxHeight || 96}
                        onChange={(e) => setPrintConfig((prev) => ({ ...prev, printSignatureBoxHeight: Number(e.target.value) }))}
                        className="w-full"
                      />
                    </div>
                  )}
                </>
              )}

              {activePrintTab === 'branding' && (
                <>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                    <span>حدود الجدول</span>
                    <input
                      type="checkbox"
                      checked={printConfig.showBorders}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, showBorders: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                    <span>تلوين الصفوف</span>
                    <input
                      type="checkbox"
                      checked={printConfig.zebraStriping}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, zebraStriping: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                    <span>تلوين الترويسة</span>
                    <input
                      type="checkbox"
                      checked={printConfig.colorHeaderRow}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, colorHeaderRow: e.target.checked }))}
                    />
                  </label>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">علامة مائية</label>
                    <input
                      title="علامة مائية"
                      type="text"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.watermarkText}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, watermarkText: e.target.value }))}
                    />
                  </div>
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                    <span>إظهار QR</span>
                    <input
                      type="checkbox"
                      checked={printConfig.showQrCode}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, showQrCode: e.target.checked }))}
                    />
                  </label>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">رابط التقرير</label>
                    <input
                      title="رابط التقرير"
                      type="text"
                      className="w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.reportUrl}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, reportUrl: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-slate-500">ملاحظة عامة</label>
                    <textarea
                      title="ملاحظة عامة"
                      className="min-h-24 w-full rounded-lg border border-slate-300 p-2"
                      value={printConfig.generalNote}
                      onChange={(e) => setPrintConfig((prev) => ({ ...prev, generalNote: e.target.value }))}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="col-span-9 flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs">
              <div className="text-slate-600">معاينة حية للباعة (WYSIWYG)</div>
              {printStatusMessage && <div className="font-bold text-indigo-700">{printStatusMessage}</div>}
            </div>

            <div className="flex-1 overflow-auto bg-slate-200 p-4">
              <div
                ref={printPageRef}
                className="mx-auto overflow-hidden bg-white"
                style={{
                  width: `${pageMetrics.pageWidthMm}mm`,
                  minHeight: `${pageMetrics.pageHeightMm}mm`,
                  paddingTop: `${pageMetrics.marginMm}mm`,
                  paddingRight: `${pageMetrics.marginMm}mm`,
                  paddingLeft: `${pageMetrics.marginMm}mm`,
                  paddingBottom: `${pageMetrics.marginMm}mm`,
                  boxSizing: 'border-box',
                }}
              >
                {preview}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">إغلاق</button>
              <button onClick={onBuildPdf} disabled={isPrintingPdf} className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {isPrintingPdf ? 'جاري التصدير...' : 'التصدير النهائي (PDF)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StocktakingPrintStudio;