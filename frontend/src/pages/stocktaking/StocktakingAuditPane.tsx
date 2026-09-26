import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Printer } from 'lucide-react';
import type { Item } from '../../types';
import {
  closeMonth,
  getMonthLabel,
  saveManualSignedPdf,
  type MonthlyAuditRow,
  type MonthlyStocktakingSession,
} from '../../services/monthlyStocktakingService';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../../store/useInventoryStore';
import { buildElementPdfDocument, saveElementPdfDocument } from '../../utils/elementPdf';
import StocktakingPrintPreview from './StocktakingPrintPreview';
import StocktakingPrintStudio from './StocktakingPrintStudio';
import {
  STOCKTAKING_PRINT_DEFAULT_CONFIG,
  buildNormalizedPrintConfig,
  buildReportCards,
  getPrintPageMetrics,
  normalizeStoredPrintTemplates,
  serializePrintConfig,
  serializePrintTemplates,
  type StocktakingPrintConfig,
  type StocktakingPrintTab,
  type StocktakingPrintTemplate,
} from './shared';

type StocktakingAuditPaneProps = {
  monthKey: string;
  start: Date;
  end: Date;
  items: Item[];
  auditRows: MonthlyAuditRow[];
  session: MonthlyStocktakingSession;
  currentUserName?: string;
  companyLogoUrl: string;
  conflictCount: number;
  isClosed: boolean;
  onSessionChanged: () => void;
  onStatusMessage: (message: string) => void;
};

const StocktakingAuditPane: React.FC<StocktakingAuditPaneProps> = ({
  monthKey,
  start,
  end,
  items,
  auditRows,
  session,
  currentUserName,
  companyLogoUrl,
  conflictCount,
  isClosed,
  onSessionChanged,
  onStatusMessage,
}) => {
  const storedPrintConfig = useInventoryStore((state) => state.stocktakingPrintConfig);
  const storedPrintTemplates = useInventoryStore((state) => state.stocktakingPrintTemplates);
  const setStoredPrintConfig = useInventoryStore((state) => state.setStocktakingPrintConfig);
  const setStoredPrintTemplates = useInventoryStore((state) => state.setStocktakingPrintTemplates);

  const [showPrintStudio, setShowPrintStudio] = useState(false);
  const [activePrintTab, setActivePrintTab] = useState<StocktakingPrintTab>('layout');
  const [printConfig, setPrintConfig] = useState<StocktakingPrintConfig>(STOCKTAKING_PRINT_DEFAULT_CONFIG);
  const [printTemplates, setPrintTemplates] = useState<StocktakingPrintTemplate[]>([]);
  const [printTemplateName, setPrintTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isPrintingPdf, setIsPrintingPdf] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [printStatusMessage, setPrintStatusMessage] = useState('');

  const signedPdfInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const printPageRef = useRef<HTMLDivElement>(null);

  const normalizedStoredPrintConfig = useMemo(
    () => buildNormalizedPrintConfig(
      (storedPrintConfig || {}) as Partial<StocktakingPrintConfig> & { cellTextVerticalAlign?: 'top' | 'middle' | 'bottom' },
      STOCKTAKING_PRINT_DEFAULT_CONFIG,
    ),
    [storedPrintConfig],
  );
  const normalizedStoredPrintTemplates = useMemo(
    () => normalizeStoredPrintTemplates(storedPrintTemplates),
    [storedPrintTemplates],
  );
  const normalizedStoredPrintConfigKey = useMemo(() => serializePrintConfig(normalizedStoredPrintConfig), [normalizedStoredPrintConfig]);
  const normalizedStoredPrintTemplatesKey = useMemo(() => serializePrintTemplates(normalizedStoredPrintTemplates), [normalizedStoredPrintTemplates]);
  const localPrintConfigKey = useMemo(() => serializePrintConfig(printConfig), [printConfig]);
  const localPrintTemplatesKey = useMemo(() => serializePrintTemplates(printTemplates), [printTemplates]);

  useEffect(() => {
    setPrintConfig((prev) => {
      if (serializePrintConfig(prev) === normalizedStoredPrintConfigKey) return prev;
      return normalizedStoredPrintConfig;
    });
  }, [normalizedStoredPrintConfig, normalizedStoredPrintConfigKey]);

  useEffect(() => {
    setPrintTemplates((prev) => {
      if (serializePrintTemplates(prev) === normalizedStoredPrintTemplatesKey) return prev;
      return normalizedStoredPrintTemplates;
    });
  }, [normalizedStoredPrintTemplates, normalizedStoredPrintTemplatesKey]);

  useEffect(() => {
    if (localPrintConfigKey === normalizedStoredPrintConfigKey) return;
    setStoredPrintConfig(printConfig as unknown as Record<string, unknown>);
  }, [localPrintConfigKey, normalizedStoredPrintConfigKey, printConfig, setStoredPrintConfig]);

  useEffect(() => {
    if (localPrintTemplatesKey === normalizedStoredPrintTemplatesKey) return;
    setStoredPrintTemplates(printTemplates as unknown as Array<Record<string, unknown>>);
  }, [localPrintTemplatesKey, normalizedStoredPrintTemplatesKey, printTemplates, setStoredPrintTemplates]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const reportCards = useMemo(() => buildReportCards(auditRows, itemById), [auditRows, itemById]);
  const visibleReportCards = useMemo(() => {
    const selected = new Set(printConfig.selectedCards);
    return reportCards.filter((card) => selected.has(card.key));
  }, [printConfig.selectedCards, reportCards]);
  const pageMetrics = useMemo(() => getPrintPageMetrics(printConfig), [printConfig]);

  const preview = useMemo(
    () => (
      <StocktakingPrintPreview
        start={start}
        companyLogoUrl={companyLogoUrl}
        printConfig={printConfig}
        visibleReportCards={visibleReportCards}
      />
    ),
    [companyLogoUrl, printConfig, start, visibleReportCards],
  );

  const savePrintTemplate = () => {
    const normalizedName = printTemplateName.trim();
    if (!normalizedName) {
      setPrintStatusMessage('يرجى إدخال اسم القالب أولاً.');
      return;
    }

    setPrintTemplates((prev) => {
      const existing = prev.find((template) => template.name === normalizedName);
      if (existing) {
        return prev.map((template) => (template.id === existing.id ? { ...template, config: printConfig, updatedAt: Date.now() } : template));
      }

      return [{ id: `tpl-${Date.now()}`, name: normalizedName, config: printConfig, updatedAt: Date.now() }, ...prev].slice(0, 25);
    });

    setPrintStatusMessage(`تم حفظ قالب الطباعة بنجاح: ${normalizedName}`);
  };

  const applyPrintTemplate = (templateId: string) => {
    const template = printTemplates.find((item) => item.id === templateId);
    if (!template) return;

    setPrintConfig(() => ({
      ...STOCKTAKING_PRINT_DEFAULT_CONFIG,
      ...template.config,
      selectedCards: Array.isArray(template.config.selectedCards)
        ? template.config.selectedCards.filter((key) => reportCards.some((card) => card.key === key))
        : STOCKTAKING_PRINT_DEFAULT_CONFIG.selectedCards,
    }));
    setSelectedTemplateId(template.id);
    setPrintTemplateName(template.name);
    setPrintStatusMessage(`تم تطبيق القالب: ${template.name}`);
  };

  const deleteSelectedPrintTemplate = () => {
    if (!selectedTemplateId) {
      setPrintStatusMessage('يرجى اختيار قالب أولاً.');
      return;
    }

    const template = printTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) return;

    toast.warning(`حذف القالب "${template.name}"؟`, {
      action: {
        label: 'تأكيد الحذف',
        onClick: () => {
          setPrintTemplates((prev) => prev.filter((item) => item.id !== selectedTemplateId));
          setSelectedTemplateId('');
          setPrintStatusMessage(`تم حذف القالب: ${template.name}`);
          toast.success('تم حذف القالب');
        },
      },
    });
  };

  const buildPdfFromPrintStudio = async () => {
    if (!printPageRef.current) return;

    try {
      setIsPrintingPdf(true);
      setPrintStatusMessage('جاري إنشاء ملف PDF...');

      await saveElementPdfDocument({
        element: printPageRef.current,
        fileName: `تقرير_الجرد_${monthKey}.pdf`,
        paperSize: printConfig.paperSize,
        orientation: printConfig.orientation,
        marginMm: [printConfig.topPageMarginMm, 0, printConfig.bottomPageMarginMm, 0],
        scale: 2,
      });

      setPrintStatusMessage('تم تنزيل ملف PDF بنجاح.');
    } catch (error) {
      setPrintStatusMessage(error instanceof Error ? error.message : 'فشل في تنزيل ملف PDF.');
    } finally {
      setIsPrintingPdf(false);
    }
  };

  const handleUploadSignedPdf = async (file: File | null) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
      saveManualSignedPdf(monthKey, file.name, file.type || 'application/pdf', base64);
      onSessionChanged();
      onStatusMessage('تم حفظ ملف PDF الموقع يدوياً.');
    };
    reader.readAsDataURL(file);
  };

  const handleCloseMonth = async () => {
    if (isClosed) return;
    if (conflictCount > 0) {
      onStatusMessage('لا يمكن إغلاق الجرد لوجود أصناف بها تعارض أو غير مجرودة.');
      return;
    }

    if (!reportRef.current) return;

    try {
      setIsClosing(true);
      const pdfName = `Jard_${getMonthLabel(monthKey)}.pdf`;

      const pdfDocument = await buildElementPdfDocument({
        element: reportRef.current,
        fileName: pdfName,
        paperSize: 'a4',
        orientation: 'portrait',
        marginMm: 0.35 * 25.4,
        scale: 2,
      });

      const dataUri = pdfDocument.toDataUri();
      pdfDocument.save();

      const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
      const result = await closeMonth({
        monthKey,
        approvedBy: currentUserName || 'النظام',
        rows: auditRows,
        archivedPdfName: pdfName,
        archivedPdfMime: 'application/pdf',
        archivedPdfData: base64,
      });

      if (!result.ok) {
        onStatusMessage(result.reason || 'فشل في إغلاق الجرد.');
        return;
      }

      onSessionChanged();
      onStatusMessage(`تم اعتماد إغلاق الجرد ${monthKey} وحفظ الجلسة على الخادم.`);
    } catch (error) {
      onStatusMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء إعداد أو إغلاق الجرد.');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold text-slate-700">
          الفترة المحاسبية: {start.toLocaleDateString('en-GB')} إلى {end.toLocaleDateString('en-GB')}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700" onClick={() => setShowPrintStudio(true)}><Printer size={14} className="inline ml-1" /> استوديو الطباعة</button>
          <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700" onClick={() => signedPdfInputRef.current?.click()}><FileUp size={14} className="inline ml-1" /> رفع PDF موقع ومعتمد</button>
          <input ref={signedPdfInputRef} type="file" title="رفع ملف PDF موقع ومعتمد" accept="application/pdf" className="hidden" onChange={(event) => { void handleUploadSignedPdf(event.target.files?.[0] || null); event.currentTarget.value = ''; }} />
          <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-60" onClick={() => { void handleCloseMonth(); }} disabled={isClosing || isClosed}>
            <CheckCircle2 size={14} className="inline ml-1" /> {isClosing ? 'جارٍ إغلاق الفترة...' : 'إغلاق واعتماد الجرد'}
          </button>
        </div>
      </div>

      <div ref={reportRef}>{preview}</div>

      {(session.archivedPdfName || session.manualSignedPdfName) && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {session.archivedPdfName ? <div>الملف المؤرشف: {session.archivedPdfName}</div> : null}
          {session.manualSignedPdfName ? <div>الملف اليدوي المعتمد: {session.manualSignedPdfName}</div> : null}
        </div>
      )}

      <StocktakingPrintStudio
        open={showPrintStudio}
        onClose={() => setShowPrintStudio(false)}
        printTemplateName={printTemplateName}
        onPrintTemplateNameChange={setPrintTemplateName}
        onSaveTemplate={savePrintTemplate}
        selectedTemplateId={selectedTemplateId}
        printTemplates={printTemplates}
        onApplyTemplate={applyPrintTemplate}
        onDeleteTemplate={deleteSelectedPrintTemplate}
        activePrintTab={activePrintTab}
        onActivePrintTabChange={setActivePrintTab}
        printConfig={printConfig}
        setPrintConfig={setPrintConfig}
        printStatusMessage={printStatusMessage}
        printPageRef={printPageRef}
        pageMetrics={pageMetrics}
        preview={preview}
        isPrintingPdf={isPrintingPdf}
        onBuildPdf={() => {
          void buildPdfFromPrintStudio();
        }}
      />
    </div>
  );
};

export default StocktakingAuditPane;