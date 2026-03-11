// ENTERPRISE FIX: Phase 2 - Full Single Source of Truth & Legacy Cleanup - 2026-03-05
// ENTERPRISE FIX: Phase 1 - Single Source of Truth & Integration - 2026-03-05
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SystemSettings, Transaction } from '../types';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Filter,
  Layers,
  ListOrdered,
  Printer,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { differenceInHours } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { useInventoryStore } from '../store/useInventoryStore';
import { useInventoryCalculations } from '@hooks/useInventoryCalculations';

interface StockBalancesProps {
  settings: SystemSettings;
  transactions?: Transaction[];
}

type SectionOrderMode =
  | 'default'
  | 'alphabetical_asc'
  | 'alphabetical_desc'
  | 'item_count_desc'
  | 'manual';

type StockSeverity = 'critical' | 'warning' | 'ok';

const SectionSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse">
    <div className="h-5 w-52 bg-slate-200 rounded mb-3" />
    <div className="space-y-2">
      <div className="h-4 bg-slate-100 rounded" />
      <div className="h-4 bg-slate-100 rounded" />
      <div className="h-4 bg-slate-100 rounded" />
      <div className="h-4 bg-slate-100 rounded" />
    </div>
  </div>
);

const StockBalances: React.FC<StockBalancesProps> = ({ settings, transactions }) => {
  const items = useInventoryStore((state) => state.items);
  const categories = useInventoryStore((state) => state.categories);
  const storeTransactions = useInventoryStore((state) => state.transactions);
  const openingBalances = useInventoryStore((state) => state.openingBalances);
  const openingBalancesYear = useInventoryStore((state) => state.openingBalancesYear);
  const loadOpeningBalances = useInventoryStore((state) => state.loadOpeningBalances);
  const loadingOpeningBalances = useInventoryStore((state) => state.openingBalancesLoading);
  const openingBalancesError = useInventoryStore((state) => state.openingBalancesError);
  const balances = useInventoryStore((state) => state.balances);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const itemsLoading = useInventoryStore((state) => state.loading || state.syncing);
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
  const activeTransactions = transactions && transactions.length > 0 ? transactions : storeTransactions;

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sectionOrderMode, setSectionOrderMode] = useState<SectionOrderMode>('default');
  const [manualCategoryOrder, setManualCategoryOrder] = useState<string[]>(categories);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  const printRef = useRef<HTMLDivElement>(null);
  const currentYear = new Date().getFullYear();
  const openingQuantities = useMemo(
    () => (openingBalancesYear === currentYear ? new Map<string, number>(Object.entries(openingBalances)) : null),
    [currentYear, openingBalances, openingBalancesYear]
  );

  const { financialYear, balanceMap, stockStatusMap, formatBalanceNumber } = useInventoryCalculations({
    items,
    openingQuantities,
    transactions: activeTransactions,
  });

  useEffect(() => {
    if (!lastLoadedAt) {
      void loadAll();
    }
  }, [lastLoadedAt, loadAll]);

  useEffect(() => {
    setManualCategoryOrder((prev) => {
      const validPrevious = prev.filter((category) => categories.includes(category));
      const newlyAdded = categories.filter((category) => !validPrevious.includes(category));
      return [...validPrevious, ...newlyAdded];
    });
  }, [categories]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim().toLowerCase());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    void loadOpeningBalances(financialYear);
  }, [financialYear, loadOpeningBalances]);

  const getHoursSinceUpdate = (dateString?: string) => {
    if (!dateString) return 'جديد';
    const hours = differenceInHours(new Date(), new Date(dateString));
    if (hours <= 0) return 'أقل من ساعة';
    return `منذ ${hours} ساعة`;
  };

  const categoryItemCountMap = useMemo(
    () =>
      categories.reduce((acc, category) => {
        acc[category] = items.filter((item) => item.category === category).length;
        return acc;
      }, {} as Record<string, number>),
    [categories, items]
  );

  const orderedCategories = useMemo(() => {
    switch (sectionOrderMode) {
      case 'alphabetical_asc':
        return [...categories].sort((a, b) => a.localeCompare(b, 'ar'));
      case 'alphabetical_desc':
        return [...categories].sort((a, b) => b.localeCompare(a, 'ar'));
      case 'item_count_desc':
        return [...categories].sort(
          (a, b) => (categoryItemCountMap[b] || 0) - (categoryItemCountMap[a] || 0)
        );
      case 'manual':
        return manualCategoryOrder.filter((category) => categories.includes(category));
      case 'default':
      default:
        return categories;
    }
  }, [categories, categoryItemCountMap, manualCategoryOrder, sectionOrderMode]);

  const filteredCategories =
    selectedCategory === 'All'
      ? orderedCategories
      : orderedCategories.filter((category) => category === selectedCategory);

  const moveManualCategory = (category: string, direction: 'up' | 'down') => {
    setManualCategoryOrder((prev) => {
      const currentIndex = prev.indexOf(category);
      if (currentIndex < 0) return prev;
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
      return next;
    });
  };

  const resetManualCategoryOrder = () => {
    setManualCategoryOrder(categories);
  };

  const getItemBalance = (itemId: string) => Number(balanceMap.get(itemId) ?? 0);

  const getStatus = (itemId: string): { severity: StockSeverity; label: string; className: string } => {
    const status = stockStatusMap.get(itemId);
    if (status?.isBelowOrder) {
      return { severity: 'critical', label: 'حرج (دون حد الطلب)', className: 'bg-red-50 text-red-700' };
    }
    if (status?.isBelowMin) {
      return { severity: 'warning', label: 'تحذير (دون حد الأمان)', className: 'bg-amber-50 text-amber-700' };
    }
    return { severity: 'ok', label: 'مستقر', className: 'bg-emerald-50 text-emerald-700' };
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
      <head>
        <title>تقرير أرصدة المخازن - ${settings.companyName}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap');
          body { font-family: 'Tajawal', sans-serif; background: #fff; color: #0f172a; padding: 16px; }
          .print-container { max-width: 1100px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
          .header { background: linear-gradient(to left, #059669, #047857); color: #fff; padding: 22px 28px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 800; }
          .header p { margin: 8px 0 0; font-size: 14px; }
          .meta { display: flex; justify-content: space-between; font-size: 12px; background: #f8fafc; padding: 10px 18px; border-bottom: 1px solid #e2e8f0; }
          .section { padding: 14px 18px 4px; }
          .section h3 { margin: 0 0 8px; color: #065f46; font-size: 15px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
          th, td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: right; }
          th { background: #f1f5f9; color: #334155; }
          .status { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; display: inline-block; }
          .ok { background: #dcfce7; color: #166534; }
          .warning { background: #fef3c7; color: #92400e; }
          .critical { background: #fee2e2; color: #991b1b; }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <script>window.onload = function(){ window.print(); window.close(); };</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const showSkeleton = itemsLoading || loadingOpeningBalances;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-sm p-6"
      >
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 mb-1">أرصدة المخازن</h2>
            <p className="text-slate-500 text-sm">
              عرض رصيد المخزن لكل صنف وفق رصيد بداية المدة والحركات التشغيلية.
            </p>
            {openingBalancesError && (
              <p className="mt-2 inline-block text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                {openingBalancesError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute right-3 top-3 text-slate-400" size={16} />
              <input
                type="text"
                className="pl-4 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm w-64"
                placeholder="بحث باسم الصنف أو كود الصنف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="relative">
              <Filter className="absolute right-3 top-3 text-slate-400" size={16} />
              <select
                className="pl-4 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm w-48"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                title="تصفية حسب التصنيف"
              >
                <option value="All">كل التصنيفات</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <ListOrdered className="absolute right-3 top-3 text-slate-400" size={16} />
              <select
                className="pl-4 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm w-64"
                value={sectionOrderMode}
                onChange={(e) => setSectionOrderMode(e.target.value as SectionOrderMode)}
                title="ترتيب الأقسام"
              >
                <option value="default">الترتيب الافتراضي</option>
                <option value="alphabetical_asc">أبجدي (أ → ي)</option>
                <option value="alphabetical_desc">أبجدي (ي → أ)</option>
                <option value="item_count_desc">حسب عدد الأصناف (الأكثر أولاً)</option>
                <option value="manual">ترتيب يدوي</option>
              </select>
            </div>

            <button
              onClick={handlePrint}
              className="bg-slate-800 text-white px-4 py-2.5 rounded-xl hover:bg-slate-900 transition flex items-center gap-2 text-sm font-semibold"
            >
              <Printer size={16} />
              طباعة
            </button>
          </div>
        </div>
      </motion.div>

      {sectionOrderMode === 'manual' && selectedCategory === 'All' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-bold text-slate-800">ترتيب الأقسام يدوياً</h3>
              <p className="text-xs text-slate-500">يُطبّق مباشرة على الشاشة وتقرير الطباعة.</p>
            </div>
            <button
              onClick={resetManualCategoryOrder}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center gap-1"
            >
              <RotateCcw size={14} />
              إعادة الضبط
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            {manualCategoryOrder
              .filter((category) => categories.includes(category))
              .map((category, index, list) => (
                <div
                  key={category}
                  className="border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-5 text-center">{index + 1}</span>
                    <span className="font-medium text-slate-700">{category}</span>
                    <span className="text-[11px] text-slate-500">
                      ({categoryItemCountMap[category] || 0} صنف)
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveManualCategory(category, 'up')}
                      disabled={index === 0}
                      className="p-1.5 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      title="نقل للأعلى"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveManualCategory(category, 'down')}
                      disabled={index === list.length - 1}
                      className="p-1.5 rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      title="نقل للأسفل"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </motion.div>
      )}

      {showSkeleton && (
        <div className="grid md:grid-cols-2 gap-4">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {!showSkeleton &&
          filteredCategories.map((category) => {
            const categoryItems = items.filter((item) => {
              if (item.category !== category) return false;
              if (!debouncedSearchTerm) return true;
              const byName = String(item.name || '').toLowerCase().includes(debouncedSearchTerm);
              const byCode = String(item.code || '').toLowerCase().includes(debouncedSearchTerm);
              return byName || byCode;
            });
            if (categoryItems.length === 0) return null;

            return (
              <motion.section
                key={category}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
              >
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center gap-2">
                  <Layers size={18} className="text-emerald-600" />
                  <h3 className="font-bold text-slate-800">{category}</h3>
                  <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                    {categoryItems.length} صنف
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="bg-white text-slate-500 border-b border-slate-100">
                      <tr>
                        <th className="px-5 py-4 font-medium">اسم الصنف</th>
                        <th className="px-5 py-4 font-medium">الوحدة</th>
                        <th className="px-5 py-4 font-medium">رصيد المخزن</th>
                        <th className="px-5 py-4 font-medium">آخر تحديث</th>
                        <th className="px-5 py-4 font-medium">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {categoryItems.map((item) => {
                        const balance = getItemBalance(item.id);
                        const status = getStatus(item.id);

                        return (
                          <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-800">{item.name}</span>
                                {status.severity !== 'ok' && (
                                  <span
                                    className="inline-flex items-center justify-center text-amber-600"
                                    title={status.label}
                                  >
                                    {status.severity === 'critical' ? (
                                      <ShieldAlert size={14} />
                                    ) : (
                                      <AlertTriangle size={14} />
                                    )}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-4 text-slate-500">{item.unit}</td>
                            <td className="px-5 py-4 font-bold text-slate-800">
                              {formatBalanceNumber(balance)}
                            </td>
                            <td className="px-5 py-4 text-slate-500 inline-flex items-center gap-1.5">
                              <Clock size={13} />
                              {getHoursSinceUpdate(item.lastUpdated)}
                            </td>
                            <td className="px-5 py-4">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${status.className}`}
                              >
                                {status.severity === 'critical' ? (
                                  <ShieldAlert size={12} />
                                ) : status.severity === 'warning' ? (
                                  <AlertTriangle size={12} />
                                ) : null}
                                {status.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </motion.section>
            );
          })}
      </AnimatePresence>

      <div className="hidden">
        <div ref={printRef} className="print-container">
          <div className="header">
            <h1>تقرير أرصدة المخازن</h1>
            <p>{settings.companyName || 'الشركة'}</p>
          </div>
          <div className="meta">
            <span>السنة المالية: {financialYear}</span>
            <span>تاريخ الطباعة: {new Date().toLocaleDateString('ar-EG')}</span>
          </div>
          {filteredCategories.map((category) => {
            const categoryItems = items.filter((item) => {
              if (item.category !== category) return false;
              if (!debouncedSearchTerm) return true;
              const byName = String(item.name || '').toLowerCase().includes(debouncedSearchTerm);
              const byCode = String(item.code || '').toLowerCase().includes(debouncedSearchTerm);
              return byName || byCode;
            });
            if (categoryItems.length === 0) return null;
            return (
              <div key={`print-${category}`} className="section">
                <h3>{category}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>اسم الصنف</th>
                      <th>الوحدة</th>
                      <th>رصيد المخزن</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryItems.map((item) => {
                      const status = getStatus(item.id);
                      return (
                        <tr key={`print-row-${item.id}`}>
                          <td>{item.name}</td>
                          <td>{item.unit}</td>
                          <td>{formatBalanceNumber(getItemBalance(item.id))}</td>
                          <td>
                            <span className={`status ${status.severity}`}>{status.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StockBalances;
