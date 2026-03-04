// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected


import React, { useState, useRef, useEffect } from 'react';
import { Item, Transaction, SystemSettings } from '../types';
import { generateStockCard, StockCardResult } from '../services/reportingService';
import { getSettings } from '../services/storage';
import { 
  FileText, Calendar, Filter, Printer, Search, 
  ArrowRight, CheckSquare, Square, X, Download
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from '@services/toastService';

interface StockCardReportProps {
  items: Item[];
  transactions: Transaction[];
  canExport?: boolean;
  onExport?: (rowCount: number) => void;
}

const StockCardReport: React.FC<StockCardReportProps> = ({ items, transactions, canExport = false, onExport }) => {
  // Filters
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  
  // Data
  const [reportData, setReportData] = useState<StockCardResult[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  
  // UI State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  const handleGenerate = () => {
    if (selectedItemIds.size === 0) {
      toast.error('7�87�7�7�7 7�7�7�8y7�7� 7�8 8~ 8�7�7�7� 7�880 7�87�88');
      return;
    }

    const results: StockCardResult[] = [];
    selectedItemIds.forEach(id => {
      const result = generateStockCard(id, startDate, endDate, transactions);
      if (result) results.push(result);
    });

    setReportData(results);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    if (!canExport) {
      toast.error('88y7� 87�8y8� 7�87�7�8y7� 7�7�7�8y7� 8�7�7�7� 7�87�8 8~.');
      return;
    }
    if (reportData.length === 0) return;
    
    const wb = XLSX.utils.book_new();
    
    reportData.forEach(card => {
        const wsData = [
            ['7�87�8y7� 8�7�7�7� 7�87�8 8~ 7�87�8~7�8y88y', settings?.companyName],
            ['7�87�8 8~:', card.item.name, '7�88�8�7�:', card.item.code || '-'],
            ['7�88~7�7�7� 8&8 :', startDate, '7�880:', endDate],
            [],
            ['7�87�7�7�8y7�', '7�88& 7�88~7�7�8�7�7�', '7�87�8y7�8 /7�88&87�7�7�7�7�', '8�7�7�7� (7�7�7�7)', '7�8 7�7�7� (7�7�7�8~7�)', '7�7�7�7� (7�8y7�)', '8!7�88� (7�7�8&)', '7�87�7�8y7�'],
            ['', '', '7�7�8y7� 7�8~7�7�7�7�8y', '', '', '', '', card.openingBalance]
        ];

        card.rows.forEach(row => {
            wsData.push([
                row.date,
                row.warehouseInvoice,
                row.notes || row.supplierOrReceiver,
                row.importQty || '',
                row.prodQty || '',
                row.exportQty || '',
                row.wasteQty || '',
                row.runningBalance
            ]);
        });

        // Add Totals Row
        wsData.push([
            '7�87�7�8&7�88y7�7�', '', '', 
            card.totalImport, 
            card.totalProduction, 
            card.totalExport, 
            card.totalWaste, 
            card.rows.length > 0 ? card.rows[card.rows.length - 1].runningBalance : card.openingBalance
        ]);

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        // Simple column width
        ws['!cols'] = [{wch:12}, {wch:15}, {wch:30}, {wch:12}, {wch:12}, {wch:12}, {wch:12}, {wch:12}];
        XLSX.utils.book_append_sheet(wb, ws, card.item.name.substring(0, 30)); 
    });

    XLSX.writeFile(wb, `StockCard_Detailed_${startDate}_${endDate}.xlsx`);
    const exportedRows = reportData.reduce((total, card) => total + card.rows.length, 0);
    onExport?.(exportedRows);
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedItemIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedItemIds(newSet);
  };

  const filteredItems = items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  // Formatter
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // Calculate closing balance properly for display
  const getClosingBalance = (card: StockCardResult) => {
      if (card.rows.length > 0) {
          return card.rows[card.rows.length - 1].runningBalance;
      }
      return card.openingBalance;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* Print Styles */}
      <style>{`
        @media print {
          @page { 
            size: A4 landscape; /* Landscape for more columns */
            margin: 10mm; 
          }
          body { 
            background: white; 
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact;
          }
          /* Hide standard UI elements */
          nav, aside, .no-print, button, .sidebar, header {
            display: none !important;
          }
          /* Ensure Report Container is visible and takes full width */
          .report-container {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
          /* Force page breaks */
          .item-card-section {
            page-break-before: always;
            break-before: page;
            margin-top: 0;
          }
          .item-card-section:first-child {
            page-break-before: auto;
          }
          /* Table Styles for Print */
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9pt;
          }
          thead {
            display: table-header-group; 
          }
          tr {
            page-break-inside: avoid;
          }
          th, td {
            border: 1px solid #000 !important; /* Stark black borders for accounting */
            padding: 4px 6px;
          }
          /* Header/Footer for Print */
          .print-header {
            display: flex !important;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #000;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .print-footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            text-align: center;
            font-size: 8pt;
            color: #666;
            border-top: 1px solid #eee;
            padding-top: 5px;
          }
        }
        .print-header, .print-footer { display: none; }
      `}</style>

      {/* --- Filters Section (No Print) --- */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 no-print">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <FileText className="text-blue-600" /> 8�7�7�7� 7�87�8 8~ 7�87�8~7�8y88y (Extended Stock Card)
            </h2>
            <p className="text-slate-500 text-sm mt-1">7�7�7�7� 7�7�8�7� 7�88�7�7�7�7R 7�87�8 7�7�7�7R 7�87�7�7�7�7R 8�7�88!7�88� 7�7�8�8 8&8 8~7�8.</p>
          </div>
          <div className="flex gap-2">
             <button onClick={handleExportExcel} disabled={!canExport} className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed" title={canExport ? '7�7�7�8y7� Excel' : '87� 7�8&88� 7�87�7�8y7� 7�87�7�7�8y7�'}>
                <Download size={16} /> Excel
             </button>
             <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition text-sm font-bold shadow-lg">
                <Printer size={16} /> 7�7�7�7�7� 7�7�8&8y7�
             </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* Multi-Select Item */}
          <div className="relative md:col-span-2">
            <label className="block text-sm font-bold text-slate-700 mb-2">7�7�7�7� 7�87�7�8 7�8~</label>
            <div 
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl cursor-pointer flex justify-between items-center"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
                <span className="text-sm text-slate-700 truncate">
                    {selectedItemIds.size === 0 ? '--- 7�7�7�7� 7�87�7�8 7�8~ ---' : `${selectedItemIds.size} 7�8 8~ 8&7�7�7�`}
                </span>
                <ArrowRight className={`transform transition-transform ${isDropdownOpen ? '-rotate-90' : 'rotate-90'} text-slate-400`} size={16} />
            </div>
            
            {isDropdownOpen && (
                <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-slate-100 bg-slate-50">
                        <div className="relative">
                            <Search size={14} className="absolute right-3 top-2.5 text-slate-400" />
                            <input 
                                type="text" 
                                className="w-full pl-2 pr-8 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500" 
                                placeholder="7�7�7�..."
                                autoFocus
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                        <div 
                            className="flex items-center gap-2 p-2 hover:bg-blue-50 rounded-lg cursor-pointer border-b border-dashed border-slate-100 mb-1"
                            onClick={() => {
                                if (selectedItemIds.size === items.length) setSelectedItemIds(new Set());
                                else setSelectedItemIds(new Set(items.map(i => i.id)));
                            }}
                        >
                            <span className="text-blue-600 font-bold text-xs">
                                {selectedItemIds.size === items.length ? '7�877�7 7�7�7�8y7� 7�88�8' : '7�7�7�8y7� 7�88�8'}
                            </span>
                        </div>
                        {filteredItems.map(item => (
                            <div 
                                key={item.id} 
                                className={`flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition ${selectedItemIds.has(item.id) ? 'bg-blue-50' : ''}`}
                                onClick={() => toggleSelection(item.id)}
                            >
                                <div className={`text-slate-400 ${selectedItemIds.has(item.id) ? 'text-blue-600' : ''}`}>
                                    {selectedItemIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-slate-700">{item.name}</p>
                                    <p className="text-[10px] text-slate-400">{item.code || '7�7�8�8  8�8�7�'} | {item.category}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="p-2 bg-slate-50 border-t border-slate-100 text-center">
                        <button onClick={() => setIsDropdownOpen(false)} className="text-xs font-bold text-blue-600 hover:underline">7�787�8 7�887�7�8&7�</button>
                    </div>
                </div>
            )}
          </div>

          {/* Dates */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">8&8  7�7�7�8y7�</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-xl" />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">7�880 7�7�7�8y7�</label>
            <div className="flex gap-2">
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-xl" />
                <button 
                    onClick={handleGenerate} 
                    className="bg-emerald-600 text-white px-4 rounded-xl hover:bg-emerald-700 shadow-md flex items-center justify-center"
                    title="7�7�7� 7�87�87�8y7�"
                >
                    <ArrowRight size={20} className="transform rotate-180" />
                </button>
            </div>
          </div>
        </div>
      </div>

      {/* --- Report Content (Printable) --- */}
      <div className="report-container space-y-8">
        {reportData.length === 0 ? (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 no-print">
                <Filter size={48} className="mx-auto mb-4 opacity-50" />
                <p>88& 7�7�7�7�8y7�7� 7�87�7�8 7�8~ 8�7�88~7�7�7� 7�87�8&8 8y7� 7�8& 7�7�77� 7�7� 7�87�7�7�</p>
            </div>
        ) : (
            reportData.map((card, idx) => (
                <div key={idx} className="item-card-section bg-white p-8 rounded-2xl shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0">
                    
                    {/* Official Print Header (Visible only in Print) */}
                    <div className="print-header">
                        <div>
                            <h1 className="text-2xl font-bold">{settings?.companyName || '7�7�8& 7�88&7�7�7�7�'}</h1>
                            <p className="text-sm">{settings?.address}</p>
                            <p className="text-sm">{settings?.phone}</p>
                        </div>
                        <div className="text-center">
                            <h2 className="text-xl font-bold border-2 border-black px-4 py-1">8�7�7�7� 7�8 8~ 7�8~7�8y88y</h2>
                            <p className="text-xs mt-1">Detailed Stock Card</p>
                        </div>
                        <div className="text-left text-sm">
                            <p>7�7�7�8y7� 7�87�7�7�7�7�: {new Date().toLocaleDateString('en-GB')}</p>
                            <p>7�8~7�7� 7�88&: <span className="page-number"></span></p>
                        </div>
                    </div>

                    {/* Card Header (Data) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 print:bg-transparent print:border-black print:rounded-none">
                        {/* Row 1: Item Info */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4 border-b border-slate-200 pb-4 print:border-black">
                            <div>
                                <span className="text-slate-500 print:text-black font-bold block text-xs">7�7�8& 7�87�8 8~</span>
                                <span className="font-bold text-slate-800 print:text-black text-lg">{card.item.name}</span>
                            </div>
                            <div>
                                <span className="text-slate-500 print:text-black font-bold block text-xs">8�8�7� 7�87�8 8~</span>
                                <span className="font-mono text-slate-800 print:text-black">{card.item.code || '-'}</span>
                            </div>
                            <div>
                                <span className="text-slate-500 print:text-black font-bold block text-xs">7�88�7�7�7�</span>
                                <span className="text-slate-800 print:text-black">{card.item.unit}</span>
                            </div>
                            <div>
                                <span className="text-slate-500 print:text-black font-bold block text-xs">7�88~7�7�7�</span>
                                <span className="text-slate-800 print:text-black font-mono dir-ltr">{startDate} â†’ {endDate}</span>
                            </div>
                        </div>

                        {/* Row 2: Totals Summary (Detailed) */}
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 items-center">
                            <div className="text-center bg-white border rounded p-2 print:border-black">
                                <span className="block text-[10px] text-slate-500 print:text-black">7�7�8y7� 7�8~7�7�7�7�8y</span>
                                <span className="block font-bold text-base text-slate-700 print:text-black dir-ltr">{fmt(card.openingBalance)}</span>
                            </div>
                            
                            {/* Incomes */}
                            <div className="text-center bg-green-50 border border-green-100 rounded p-2 print:bg-transparent print:border-black">
                                <span className="block text-[10px] text-green-700 print:text-black font-bold">7�7�8&7�88y 7�88�7�7�7�</span>
                                <span className="block font-bold text-base text-green-800 print:text-black dir-ltr">{fmt(card.totalImport)}</span>
                            </div>
                            <div className="text-center bg-blue-50 border border-blue-100 rounded p-2 print:bg-transparent print:border-black">
                                <span className="block text-[10px] text-blue-700 print:text-black font-bold">7�7�8&7�88y 7�87�8 7�7�7�</span>
                                <span className="block font-bold text-base text-blue-800 print:text-black dir-ltr">{fmt(card.totalProduction)}</span>
                            </div>

                            {/* Outcomes */}
                            <div className="text-center bg-red-50 border border-red-100 rounded p-2 print:bg-transparent print:border-black">
                                <span className="block text-[10px] text-red-700 print:text-black font-bold">7�7�8&7�88y 7�87�7�7�7�</span>
                                <span className="block font-bold text-base text-red-800 print:text-black dir-ltr">{fmt(card.totalExport)}</span>
                            </div>
                            <div className="text-center bg-amber-50 border border-amber-100 rounded p-2 print:bg-transparent print:border-black">
                                <span className="block text-[10px] text-amber-700 print:text-black font-bold">7�7�8&7�88y 7�88!7�88�</span>
                                <span className="block font-bold text-base text-amber-800 print:text-black dir-ltr">{fmt(card.totalWaste)}</span>
                            </div>

                            <div className="text-center bg-slate-800 text-white print:bg-transparent print:text-black rounded p-2 print:border-black print:border">
                                <span className="block text-[10px] text-slate-300 print:text-black">7�7�8y7� 7�7�7�8&8y</span>
                                <span className="block font-extrabold text-lg text-white print:text-black dir-ltr">{fmt(getClosingBalance(card))}</span>
                            </div>
                        </div>
                    </div>

                    {/* Detailed Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-right text-sm border-collapse">
                            <thead className="bg-slate-100 text-slate-700 print:bg-gray-200 print:text-black border-b-2 border-slate-300 print:border-black">
                                <tr>
                                    <th className="p-2 text-center w-8">#</th>
                                    <th className="p-2 min-w-[90px]">7�87�7�7�8y7�</th>
                                    <th className="p-2 min-w-[ظ -ظ©]">7�88&7�7�8 7�</th>
                                    <th className="p-2">7�87�8y7�8  / 7�87�8!7�</th>
                                    {/* Additions */}
                                    <th className="p-2 bg-green-50 print:bg-transparent text-center min-w-[70px]">8�7�7�7�</th>
                                    <th className="p-2 bg-blue-50 print:bg-transparent text-center min-w-[70px]">7�8 7�7�7�</th>
                                    {/* Deductions */}
                                    <th className="p-2 bg-red-50 print:bg-transparent text-center min-w-[70px]">7�7�7�7�</th>
                                    <th className="p-2 bg-amber-50 print:bg-transparent text-center min-w-[70px]">8!7�88�</th>
                                    {/* Balance */}
                                    <th className="p-2 bg-slate-50 print:bg-transparent text-center min-w-[ظ -ظ©]">7�87�7�8y7�</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 print:divide-black text-xs md:text-sm">
                                {/* Opening Balance Row */}
                                <tr className="bg-slate-50 print:bg-transparent font-bold">
                                    <td colSpan={4} className="p-2 text-center">7�7�8y7� 8&7� 87�8 7�88~7�7�7� (Opening Balance)</td>
                                    <td className="p-2 text-center">-</td>
                                    <td className="p-2 text-center">-</td>
                                    <td className="p-2 text-center">-</td>
                                    <td className="p-2 text-center">-</td>
                                    <td className="p-2 text-center font-bold dir-ltr">{fmt(card.openingBalance)}</td>
                                </tr>
                                {/* Transactions */}
                                {card.rows.map((row, rIdx) => (
                                    <tr key={row.id} className="hover:bg-slate-50 print:hover:none odd:bg-white even:bg-slate-50/50 print:even:bg-transparent">
                                        <td className="p-2 text-center text-slate-400 print:text-black font-mono">{rIdx + 1}</td>
                                        <td className="p-2 whitespace-nowrap dir-ltr">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                                        <td className="p-2 font-mono">{row.warehouseInvoice}</td>
                                        <td className="p-2 max-w-[150px] truncate print:whitespace-normal">
                                            <span className="font-bold block">{row.supplierOrReceiver}</span>
                                            {row.notes && <span className="text-[10px] text-slate-400 print:text-black italic">{row.notes}</span>}
                                        </td>
                                        
                                        {/* Import */}
                                        <td className="p-2 text-center text-green-700 print:text-black font-medium dir-ltr bg-green-50/20 print:bg-transparent">
                                            {row.importQty > 0 ? fmt(row.importQty) : '-'}
                                        </td>
                                        {/* Production */}
                                        <td className="p-2 text-center text-blue-700 print:text-black font-medium dir-ltr bg-blue-50/20 print:bg-transparent">
                                            {row.prodQty > 0 ? fmt(row.prodQty) : '-'}
                                        </td>
                                        
                                        {/* Export */}
                                        <td className="p-2 text-center text-red-700 print:text-black font-medium dir-ltr bg-red-50/20 print:bg-transparent">
                                            {row.exportQty > 0 ? fmt(row.exportQty) : '-'}
                                        </td>
                                        {/* Waste */}
                                        <td className="p-2 text-center text-amber-700 print:text-black font-medium dir-ltr bg-amber-50/20 print:bg-transparent">
                                            {row.wasteQty > 0 ? fmt(row.wasteQty) : '-'}
                                        </td>

                                        {/* Balance */}
                                        <td className="p-2 text-center font-bold text-slate-800 print:text-black dir-ltr bg-slate-50/50 print:bg-transparent">
                                            {fmt(row.runningBalance)}
                                        </td>
                                    </tr>
                                ))}
                                {card.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="p-4 text-center text-slate-400 italic">87� 7�8�7�7� 7�7�8�7�7� 7�87�8 8!7�8! 7�88~7�7�7�</td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot className="bg-slate-100 print:bg-gray-200 font-bold border-t-2 border-slate-300 print:border-black">
                                <tr>
                                    <td colSpan={4} className="p-2 text-center">7�87�7�8&7�88y7�7� (Totals)</td>
                                    <td className="p-2 text-center dir-ltr text-green-800 print:text-black">{fmt(card.totalImport)}</td>
                                    <td className="p-2 text-center dir-ltr text-blue-800 print:text-black">{fmt(card.totalProduction)}</td>
                                    <td className="p-2 text-center dir-ltr text-red-800 print:text-black">{fmt(card.totalExport)}</td>
                                    <td className="p-2 text-center dir-ltr text-amber-800 print:text-black">{fmt(card.totalWaste)}</td>
                                    <td className="p-2 text-center dir-ltr bg-slate-200 print:bg-transparent">{fmt(getClosingBalance(card))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="print-footer">
                        8 7�7�8& 7�7�7�7�7� 7�88&7�7�7�8  - {settings?.companyName} | 7�8& 7�87�7�7�7�7�7�7� 8~8y {new Date().toLocaleString('en-GB')}
                    </div>
                </div>
            ))
        )}
      </div>
    </div>
  );
};

export default StockCardReport;


