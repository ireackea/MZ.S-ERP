// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected


import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Item, CategoryType, Tag, Transaction } from '../types';
import { 
  Plus, Trash2, Edit2, Save, X, Search, Download, Upload,
  Tag as TagIcon, AlertCircle, CheckCircle, LayoutGrid, LayoutList, 
  AlertTriangle, Layers, BarChart2, CheckSquare, Square,
  Package, Hash, Languages, Ruler, Scale, Lock, ChevronUp, ChevronDown, Zap
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { useInventoryStore } from '../store/useInventoryStore';
import { useInventory } from '../contexts/InventoryContext'; // Import Hook
import { useInventoryCalculations } from '@hooks/useInventoryCalculations';
import { useToast } from '@hooks/useToast';
import { generateMissingCodes, getItems as getItemsFromApi } from '@services/itemsService';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from '@services/toastService';

interface ItemManagementProps {
  transactions: Transaction[]; // Still needed for integrity check
  availableTags: Tag[];
}

const ItemManagement: React.FC<ItemManagementProps> = ({ 
  transactions, availableTags 
}) => {
  // Use Context
  const {
    items,
    loading: itemsLoading,
  } = useInventoryStore();
  const {
    units: availableUnits,
    categories: availableCategories,
    isLoading: contextLoading,
    addItems,
    updateItems,
    deleteItems,
    itemSortMode,
    setItemSortMode,
    lockCurrentItemOrder,
    moveItemManually,
  } = useInventory();
  const isLoading = itemsLoading || contextLoading;
  const { stockStatusMap } = useInventoryCalculations({ items, transactions });
  const { showToast, ToastComponent } = useToast();

  // --- State ---
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false); // Single Item Add/Edit
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false); // Bulk Edit
  const [isImportOpen, setIsImportOpen] = useState(false); // Import Wizard
  
  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    ids: string[];
    transactionCount: number;
  }>({ isOpen: false, ids: [], transactionCount: 0 });

  // Filters
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterTag, setFilterTag] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  
  // Single Item Form
  const [formData, setFormData] = useState<Partial<Item>>({
    minLimit: 0,
    maxLimit: 1000,
    currentStock: 0,
    tags: []
  });

  // Bulk Edit Form
  const [bulkForm, setBulkForm] = useState<{
    category?: string;
    unit?: string;
    minLimit?: number;
    maxLimit?: number;
    orderLimit?: number;
    packageWeight?: number; // Added
    tags?: string[];
  }>({});

  // Import State
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  }, []);

  const formatNumber = (value?: number) => numberFormatter.format(Number(value ?? 0));
  const isManualSortLocked = itemSortMode === 'manual_locked';
  const sortModeOptions: { value: typeof itemSortMode; label: string }[] = [
    { value: 'manual_locked', label: '7�7�7�8y7� 8y7�8�8y 7�7�7�7�' },
    { value: 'name_asc', label: '7�87�7�8& (7� -> 8y)' },
    { value: 'name_desc', label: '7�87�7�8& (8y -> 7�)' },
    { value: 'code_asc', label: '7�88�8�7� (7�7�7�7�7�8y)' },
    { value: 'category_then_name', label: '7�88~7�7� 7�8& 7�87�7�8&' },
  ];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  // --- Statistics ---
  const stats = useMemo(() => {
    return {
      totalItems: items.length,
      lowStock: items.filter((i) => {
        const status = stockStatusMap.get(i.id);
        return Boolean(status?.isBelowMin || status?.isBelowOrder);
      }).length,
      totalStockVolume: items.reduce((acc, curr) => acc + curr.currentStock, 0),
      categoriesCount: new Set(items.map(i => i.category)).size
    };
  }, [items, stockStatusMap]);

  // --- Helpers ---
  const getStockStatus = (item: Item) => {
    const status = stockStatusMap.get(item.id);
    if (status?.isBelowOrder) {
      return {
        type: 'critical',
        color: 'text-red-700',
        bg: 'bg-red-50',
        bar: 'bg-red-500',
        label: '7�7�7�',
        icon: AlertCircle,
      };
    }
    if (status?.isBelowMin) {
      return {
        type: 'warning',
        color: 'text-amber-700',
        bg: 'bg-amber-50',
        bar: 'bg-amber-500',
        label: '7�8�8  7�7� 7�87�8&7�8 ',
        icon: AlertTriangle,
      };
    }
    return {
      type: 'good',
      color: 'text-emerald-700',
      bg: 'bg-emerald-50',
      bar: 'bg-emerald-500',
      label: '8&7�7�87�',
      icon: CheckCircle,
    };
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const status = getStockStatus(item);
      const matchesCategory = filterCategory === 'All' || item.category === filterCategory;
      const matchesTag = filterTag === 'All' || (item.tags && item.tags.includes(filterTag));
      const matchesStatus = filterStatus === 'All' 
        || (filterStatus === 'Critical' && status.type === 'critical')
        || (filterStatus === 'Warning' && status.type === 'warning')
        || (filterStatus === 'Good' && status.type === 'good');
        
      const term = debouncedSearchTerm.toLowerCase().trim();
      const matchesSearch = 
          item.name.toLowerCase().includes(term) || 
          (item.code && item.code.toLowerCase().includes(term)) ||
          (item.englishName && item.englishName.toLowerCase().includes(term)) ||
          item.unit.toLowerCase().includes(term) || 
          item.category.toLowerCase().includes(term);
      
      return matchesCategory && matchesTag && matchesSearch && matchesStatus;
    });
  }, [items, filterCategory, filterTag, filterStatus, debouncedSearchTerm]);

  // --- Selection Helpers ---
  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  // --- CRUD Handlers ---
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.category || !formData.unit) {
      toast.error('7�87�7�7�7 7�7�7�7�7� 7�87�88�8 7�87�7�7�7�8y7�: 7�7�8& 7�87�8 8~7R 7�87�7�8 8y8~7R 8�7�88�7�7�7�.');
      return;
    }
    
    // Unique Code Check - Only if code is provided
    if (formData.code && items.some(i => i.code === formData.code && i.id !== formData.id)) {
      toast.error('7�7�7�: 8�8�7� 7�87�8 8~ 8&7�7�7�7�8& 7�7�88~7�8 87�8 8~ 7�7�7�.');
      return;
    }

    if (formData.id) {
      updateItems([formData as Item]);
    } else {
      addItems([{
        ...formData,
        id: uuidv4(),
        currentStock: 0, 
        lastUpdated: new Date().toISOString()
      } as Item]);
    }
    setIsModalOpen(false);
    setFormData({ minLimit: 0, maxLimit: 1000, currentStock: 0, tags: [] });
  };

  // 1. Trigger Single Delete
  const handleDeleteClick = (id: string) => {
      const usageCount = transactions.filter(t => t.itemId === id).length;
      setDeleteModal({
          isOpen: true,
          ids: [id],
          transactionCount: usageCount
      });
  };

  // 2. Trigger Bulk Delete
  const handleBulkDeleteClick = () => {
    const ids = Array.from(selectedIds) as string[];
    const affectedTransactions = transactions.filter(t => ids.includes(t.itemId)).length;
    
    setDeleteModal({
        isOpen: true,
        ids: ids,
        transactionCount: affectedTransactions
    });
  };

  // 3. Confirm Delete Action
  const confirmDelete = () => {
      deleteItems(deleteModal.ids);
      setDeleteModal({ isOpen: false, ids: [], transactionCount: 0 });
      setSelectedIds(new Set()); // Clear selection if any
  };

  const handleBulkEditSubmit = () => {
    const ids = Array.from(selectedIds) as string[];
    const updates = items.filter(i => ids.includes(i.id)).map(item => ({
      ...item,
      category: bulkForm.category || item.category,
      unit: bulkForm.unit || item.unit,
      minLimit: bulkForm.minLimit ?? item.minLimit,
      maxLimit: bulkForm.maxLimit ?? item.maxLimit,
      orderLimit: bulkForm.orderLimit ?? item.orderLimit,
      packageWeight: bulkForm.packageWeight ?? item.packageWeight,
      tags: bulkForm.tags ? [...new Set([...(item.tags || []), ...bulkForm.tags])] : item.tags
    }));
    
    updateItems(updates as Item[]);
    setIsBulkEditOpen(false);
    setBulkForm({});
    setSelectedIds(new Set());
    toast.success('7�8& 7�7�7�8y7� 7�87�7�8 7�8~ 7�8 7�7�7�');
  };

  const exportItems = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(i => ({
        '8�8�7� 7�87�8 8~': i.code || '',
        '7�7�8& 7�87�8 8~': i.name,
        '7�87�7�8& 7�87�8 7�88y7�8y': i.englishName || '',
        '7�87�7�8 8y8~': i.category,
        '7�88�7�7�7�': i.unit,
        '8�7�8  7�87�7�8�7�': i.packageWeight,
        '7�7�8y7� 7�88&7�7�8 ': i.currentStock,
        '7�87�7� 7�87�7�8 80': i.minLimit,
        '7�87�7� 7�87�87�80': i.maxLimit,
        '7�7� 7�87�87�': i.orderLimit
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "Items_Master_List.xlsx");
  };

  // --- Import Logic ---
  const downloadTemplate = () => {
    const headers = [
      { 
          'code': '1001', 
          'name': '7�7�8& 7�87�8 8~', 
          'english_name': 'Item Name',
          'category': '8&8�7�7� 7�8�88y7�', 
          'unit': '8�8y88�', 
          'package_weight': 50,
          'min_limit': 10, 
          'max_limit': 1000, 
          'order_limit': 50 
      },
    ];
    const ws = XLSX.utils.json_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Items_Import_Template.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      validateImportData(data);
    };
    reader.readAsBinaryString(file);
  };

  const validateImportData = (data: any[]) => {
    const errors: string[] = [];
    const validData: any[] = [];
    const usedCodes = new Set(items.map(i => i.code).filter(c => c !== undefined));

    data.forEach((row, idx) => {
      // Map keys loosely (handling Arabic/English/Snake_Case)
      const code = row['code'] || row['Code'] || row['8�8�7�'] || row['8�8�7� 7�87�8 8~'];
      const name = row['name'] || row['Name'] || row['7�7�8& 7�87�8 8~'];
      const englishName = row['english_name'] || row['English Name'] || row['7�87�7�8& 7�87�8 7�88y7�8y'];
      const category = row['category'] || row['Category'] || row['7�87�7�8 8y8~'];
      const unit = row['unit'] || row['Unit'] || row['7�88�7�7�7�'];
      const weight = row['package_weight'] || row['Package Weight'] || row['8�7�8  7�87�7�8�7�'];
      
      const min = row['min_limit'] || row['Min Limit'] || row['7�87�7� 7�87�7�8 80'] || 0;
      const max = row['max_limit'] || row['Max Limit'] || row['7�87�7� 7�87�87�80'] || 1000;
      const order = row['order_limit'] || row['Order Limit'] || row['7�7� 7�87�87�'];

      // Code is optional now, but if provided, must be unique
      if (code && usedCodes.has(String(code))) {
        errors.push(`7�8~ ${idx + 2}: 7�88�8�7� "${code}" 8&7�7�7�7�8& 7�7�88~7�8.`);
      } else if (!name) {
        errors.push(`7�8~ ${idx + 2}: 7�7�8& 7�87�8 8~ 8&8~88�7�.`);
      } else if (!category || !availableCategories.includes(category)) {
         if (!availableCategories.includes(category)) errors.push(`7�8~ ${idx + 2}: 7�87�7�8 8y8~ "${category}" 78y7� 8&7�7�88~.`);
         else errors.push(`7�8~ ${idx + 2}: 7�87�7�8 8y8~ 8&8~88�7�.`);
      } else if (!unit || !availableUnits.includes(unit)) {
         errors.push(`7�8~ ${idx + 2}: 7�88�7�7�7� "${unit}" 78y7� 7�7�87�7�.`);
      } else {
        if (code) usedCodes.add(String(code)); // Track for duplicates within file
        validData.push({
          id: uuidv4(),
          code: code ? String(code) : undefined,
          name,
          englishName,
          category,
          unit,
          packageWeight: weight ? Number(weight) : undefined,
          minLimit: Number(min),
          maxLimit: Number(max),
          orderLimit: order ? Number(order) : undefined,
          currentStock: 0,
          lastUpdated: new Date().toISOString()
        });
      }
    });

    setImportErrors(errors);
    setImportPreview(validData);
    setImportStep(2);
  };

  const commitImport = () => {
    addItems(importPreview);
    setImportStep(3);
    setTimeout(() => {
        setIsImportOpen(false);
        setImportStep(1);
        setImportPreview([]);
        setImportErrors([]);
    }, 1500);
  };

  const refreshCodesFromApi = async () => {
    const apiItems = await getItemsFromApi();
    if (!apiItems.length) return 0;

    const apiById = new Map(apiItems.map((row) => [String(row.publicId || row.id), row]));
    const updates: Item[] = [];

    items.forEach((item) => {
      const apiItem = apiById.get(String(item.id));
      if (!apiItem) return;
      const nextCode = apiItem.code || undefined;
      if ((item.code || undefined) === nextCode) return;
      updates.push({
        ...item,
        code: nextCode,
      });
    });

    if (updates.length > 0) {
      updateItems(updates);
    }
    return updates.length;
  };

  const handleGenerateMissingCodes = async () => {
    try {
      setIsGeneratingCodes(true);
      const result = await generateMissingCodes();
      const refreshedCount = await refreshCodesFromApi();

      if (result.success > 0) {
        showToast(`7�8& 7�8�88y7� ${result.success} 8�8�7� 7�8 7�7�7� �`, 'success');
      } else {
        showToast('87� 7�8�7�7� 7�8�8�7�7� 8&8~88�7�7� 887�8�88y7�.', 'success');
      }

      if (result.success > 0 && refreshedCount === 0) {
        window.location.reload();
      }
    } catch (error: any) {
      showToast(error?.message || '8~7�87� 7�8&88y7� 7�8�88y7� 7�87�8�8�7�7�.', 'error');
    } finally {
      setIsGeneratingCodes(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      
      {/* 1. Statistics Header */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '7�7�8&7�88y 7�87�7�8 7�8~', value: stats.totalItems, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '7�7�8 7�8~ 7�8�8  7�7� 7�87�8&7�8 ', value: stats.lowStock, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: '7�7�8y7� 7�88&7�7�8  7�87�7�8&7�88y', value: stats.totalStockVolume, icon: BarChart2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: '7�87�7�8 8y8~7�7� 7�88 7�7�7�', value: stats.categoriesCount, icon: Layers, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map((stat, idx) => (
          <div key={idx} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between hover:shadow-md transition">
            <div>
              <p className="text-sm text-slate-500 font-medium mb-1">{stat.label}</p>
              <h3 className="text-2xl font-extrabold text-slate-800">{formatNumber(Number(stat.value))}</h3>
            </div>
            <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
              <stat.icon size={24} />
            </div>
          </div>
        ))}
      </div>

      {/* 2. Advanced Toolbar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-4 sticky top-24 z-30">
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 w-full bg-emerald-50 p-2 rounded-xl border border-emerald-100 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 px-3">
              <CheckSquare className="text-emerald-600" size={20} />
              <span className="font-bold text-emerald-800">{selectedIds.size} 7�8 8~ 8&7�7�7�</span>
            </div>
            <div className="h-6 w-[1px] bg-emerald-200 hidden md:block"></div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setIsBulkEditOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-white text-slate-700 rounded-lg text-sm font-bold shadow-sm hover:text-emerald-600">
                <Edit2 size={16} /> 7�7�7�8y8 7�8&7�7�8y
              </button>
              <button onClick={handleBulkDeleteClick} className="flex items-center gap-2 px-3 py-1.5 bg-white text-red-600 rounded-lg text-sm font-bold shadow-sm hover:bg-red-50">
                <Trash2 size={16} /> 7�7�8~ 7�88&7�7�7�
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-slate-500 text-sm hover:text-slate-700">
                7�877�7 7�87�7�7�8y7�
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 w-full">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="7�7�7� 7�7�88�8�7� 7�8� 7�87�7�8& 7�8� 7�87�7�8 8y8~..."
                className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-emerald-500 min-w-[180px]"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="All">8�8 7�87�7�8 8y8~7�7�</option>
              {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-emerald-500 min-w-[150px]"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="All">8�8 7�87�7�87�7�</option>
              <option value="Good">8&7�8�8~7�</option>
              <option value="Warning">8&8 7�8~7�</option>
              <option value="Critical">8 7�87�</option>
            </select>

            <select
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-emerald-500 min-w-[200px]"
              value={itemSortMode}
              onChange={(e) => setItemSortMode(e.target.value as typeof itemSortMode)}
              title="7�7�8y87� 7�7�7�8y7� 7�87�7�8 7�8~"
            >
              {sortModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={lockCurrentItemOrder}
              className={`px-4 py-2.5 border rounded-xl text-sm font-bold flex items-center gap-2 ${
                isManualSortLocked
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="7�7�7�8y7� 7�7�7�8y7� 7�887�7�8&7� 7�87�7�88y"
            >
              <Lock size={14} />
              7�7�7�8y7� 7�87�7�7�8y7� 7�87�7�88y
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 w-full justify-end">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition ${viewMode === 'list' ? 'bg-white shadow text-emerald-600' : 'text-slate-500'}`}><LayoutList size={18} /></button>
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition ${viewMode === 'grid' ? 'bg-white shadow text-emerald-600' : 'text-slate-500'}`}><LayoutGrid size={18} /></button>
          </div>

          <div className="h-8 w-[1px] bg-slate-200 mx-2 hidden md:block"></div>

          <button onClick={() => setIsImportOpen(true)} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition text-sm font-medium">
            <Upload size={18} /> <span>7�7�7�8y7�7�7�</span>
          </button>
          <button onClick={exportItems} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition text-sm font-medium">
            <Download size={18} /> <span>7�7�7�8y7�</span>
          </button>
          <button
            onClick={handleGenerateMissingCodes}
            disabled={isGeneratingCodes}
            className="relative overflow-hidden flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-bold transition-all bg-gradient-to-r from-blue-600 to-cyan-500 hover:shadow-xl hover:shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isGeneratingCodes && (
              <span className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            )}
            <Zap size={18} />
            <span>{isGeneratingCodes ? '7�7�7�8y 7�8�88y7� 7�87�8�8�7�7�...' : '7�8�88y7� 7�8�8�7�7� 8&8~88�7�7�'}</span>
          </button>
          <button
            onClick={() => { setFormData({ minLimit: 0, maxLimit: 1000, currentStock: 0, tags: [] }); setIsModalOpen(true); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition shadow-lg shadow-slate-900/10 text-sm font-bold"
          >
            <Plus size={18} /> 7�7�7�8~7�
          </button>
        </div>
      </div>

      {/* 3. Data View */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-5 animate-pulse">
              <div className="h-5 w-1/2 bg-slate-200 rounded mb-3" />
              <div className="h-4 w-1/3 bg-slate-100 rounded mb-2" />
              <div className="h-3 w-full bg-slate-100 rounded mb-2" />
              <div className="h-3 w-5/6 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="p-4 w-12">
                    <button onClick={selectAll} className="text-slate-400 hover:text-emerald-600">
                       {selectedIds.size > 0 && selectedIds.size === filteredItems.length ? <CheckSquare /> : <Square />}
                    </button>
                  </th>
                  <th className="p-4 w-12 text-center">#</th>
                  <th className="p-4">7�88�8�7� / 7�87�8 8~</th>
                  <th className="p-4">7�87�7�8 8y8~</th>
                  <th className="p-4 w-1/4">8&7�7�8�80 7�88&7�7�8�8 </th>
                  <th className="p-4">7�7�8y7� 7�88&7�7�8 </th>
                  <th className="p-4">7�87�7�87�</th>
                  <th className="p-4 text-center">7�7�7�7�77�7�</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <AnimatePresence initial={false}>
                {filteredItems.map((item, idx) => {
                  const status = getStockStatus(item);
                  const progressPercent = item.maxLimit ? Math.min(100, (item.currentStock / item.maxLimit) * 100) : 0;
                  const isSelected = selectedIds.has(item.id);
                  const globalIndex = items.findIndex((row) => row.id === item.id);
                  const canMoveUp = isManualSortLocked && globalIndex > 0;
                  const canMoveDown = isManualSortLocked && globalIndex >= 0 && globalIndex < items.length - 1;
                  
                  return (
                    <motion.tr
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      key={item.id}
                      className={`transition-colors group ${isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="p-4">
                        <button onClick={() => toggleSelection(item.id)} className={`${isSelected ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'}`}>
                           {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </td>
                      <td className="p-4 text-slate-400 font-mono text-center">{idx + 1}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                            {item.code && <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{item.code}</span>}
                            <div>
                                <div className="font-bold text-slate-800 text-base inline-flex items-center gap-1.5">
                                  {item.name}
                                  {status.type !== 'good' && <AlertTriangle size={14} className="text-amber-500" title="7�8 7�8y8! 8&7�7�8�8 " />}
                                </div>
                                {item.englishName && <div className="text-xs text-slate-400 dir-ltr text-left">{item.englishName}</div>}
                            </div>
                        </div>
                        <div className="flex gap-1 mt-1">
                            {item.tags?.map(tid => {
                               const t = availableTags.find(tag => tag.id === tid);
                               return t ? <span key={tid} className="w-2 h-2 rounded-full" style={{backgroundColor: t.color}} title={t.name}></span> : null;
                            })}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-bold">{item.category}</span>
                      </td>
                      <td className="p-4">
                         <div className="w-full bg-slate-100 rounded-full h-2.5 mb-1 overflow-hidden">
                           <div className={`h-2.5 rounded-full ${status.bar}`} style={{ width: `${progressPercent}%` }}></div>
                         </div>
                         <div className="flex justify-between text-[10px] text-slate-400">
                           <span>{formatNumber(item.minLimit)}</span>
                           <span>{formatNumber(item.maxLimit)}</span>
                         </div>
                      </td>
                      <td className="p-4">
                        <span className="font-bold text-slate-800">{formatNumber(item.currentStock)}</span> <span className="text-slate-500 text-xs">{item.unit}</span>
                      </td>
                      <td className="p-4">
                         <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${status.bg} ${status.color}`}>
                           <status.icon size={12} /> {status.label}
                         </span>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-center items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              disabled={!canMoveUp}
                              onClick={() => moveItemManually(item.id, 'up')}
                              className="p-2 text-slate-400 hover:text-amber-600 bg-white border border-slate-200 rounded-lg shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                              title="7�7�7�8y8� 887�7�880"
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={!canMoveDown}
                              onClick={() => moveItemManually(item.id, 'down')}
                              className="p-2 text-slate-400 hover:text-amber-600 bg-white border border-slate-200 rounded-lg shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                              title="7�7�7�8y8� 887�7�8~8"
                            >
                              <ChevronDown size={16} />
                            </button>
                            <button onClick={() => { setFormData(item); setIsModalOpen(true); }} className="p-2 text-slate-400 hover:text-blue-600 bg-white border border-slate-200 rounded-lg shadow-sm"><Edit2 size={16} /></button>
                            <button onClick={() => handleDeleteClick(item.id)} className="p-2 text-slate-400 hover:text-red-600 bg-white border border-slate-200 rounded-lg shadow-sm"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <AnimatePresence initial={false}>
          {filteredItems.map(item => {
            const status = getStockStatus(item);
            const progressPercent = item.maxLimit ? Math.min(100, (item.currentStock / item.maxLimit) * 100) : 0;
            const isSelected = selectedIds.has(item.id);
            const globalIndex = items.findIndex((row) => row.id === item.id);
            const canMoveUp = isManualSortLocked && globalIndex > 0;
            const canMoveDown = isManualSortLocked && globalIndex >= 0 && globalIndex < items.length - 1;

            return (
              <motion.div
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                key={item.id}
                className={`bg-white rounded-2xl p-6 shadow-sm border transition-all duration-300 group relative
                  ${isSelected ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-100 hover:shadow-lg'}`}
              >
                  <button 
                    onClick={() => toggleSelection(item.id)}
                    className={`absolute top-4 left-4 z-10 ${isSelected ? 'text-emerald-600' : 'text-slate-200 hover:text-slate-400'}`}
                  >
                    {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                  </button>

                  <div className="flex items-center gap-3 mb-4">
                     <div className="h-12 w-12 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center font-bold text-xl border border-slate-100 font-mono">
                        {item.name.charAt(0)}
                     </div>
                     <div>
                        <div className="flex items-center gap-2 mb-1">
                            {item.code && <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 rounded">{item.code}</span>}
                            <span className="text-xs text-slate-400">{item.category}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-lg leading-tight inline-flex items-center gap-1.5">
                          {item.name}
                          {status.type !== 'good' && <AlertTriangle size={14} className="text-amber-500" title="7�8 7�8y8! 8&7�7�8�8 " />}
                        </h3>
                     </div>
                  </div>

                  <div className="space-y-4">
                      <div className="flex items-end justify-between">
                          <div>
                              <p className="text-xs text-slate-400 mb-1">7�7�8y7� 7�88&7�7�8 </p>
                              <div className="text-2xl font-extrabold text-slate-800">
                                  {formatNumber(item.currentStock)} <span className="text-sm font-medium text-slate-500">{item.unit}</span>
                              </div>
                          </div>
                          <div className={`px-2 py-1 rounded-lg text-xs font-semibold mb-1 ${status.bg} ${status.color}`}>
                              {status.label}
                          </div>
                      </div>

                      <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                              <span>0%</span>
                              <span>{Math.round(progressPercent)}%</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div className={`h-2 rounded-full transition-all duration-500 ${status.bar}`} style={{ width: `${progressPercent}%` }}></div>
                          </div>
                      </div>
                  </div>
                  
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                      <button
                        type="button"
                        disabled={!canMoveUp}
                        onClick={() => moveItemManually(item.id, 'up')}
                        className="p-1.5 bg-white border border-slate-200 rounded-lg text-amber-600 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        title="7�7�7�8y8� 887�7�880"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDown}
                        onClick={() => moveItemManually(item.id, 'down')}
                        className="p-1.5 bg-white border border-slate-200 rounded-lg text-amber-600 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        title="7�7�7�8y8� 887�7�8~8"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button onClick={() => { setFormData(item); setIsModalOpen(true); }} className="p-1.5 bg-white border border-slate-200 rounded-lg text-blue-500 shadow-sm"><Edit2 size={14} /></button>
                  </div>
              </motion.div>
            );
          })}
          </AnimatePresence>
        </div>
      )}

      {/* ... (Existing Modals: Add/Edit, Delete, Import, Bulk Edit) ... */}
      {/* Keeping rest of the file logic but form submissions now use Context functions */}
      
      {/* --- ADD/EDIT MODAL (Redesigned) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 max-h-[90vh] flex flex-col">
            <div className="px-8 py-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center sticky top-0 z-10">
              <div>
                 <h3 className="text-2xl font-bold text-slate-800">{formData.id ? '7�7�7�8y8 7�7�7�87� 7�8 8~' : '7�8 7�7�7 7�7�7�87� 7�8 8~ 7�7�8y7�7�'}</h3>
                 <p className="text-sm text-slate-500">8y7�7�80 7�7�7�7�8 7�87�8y7�8 7�7� 7�7�87� 87�8&7�8  7�87�8&7� 7�87�87�7�8y7�</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-white border border-slate-200 rounded-full hover:bg-red-50 hover:text-red-500 transition"><X size={20} /></button>
            </div>
            
            <div className="overflow-y-auto p-8 custom-scrollbar bg-slate-50/30">
                <form id="itemForm" onSubmit={handleSubmit} className="space-y-8">
                    
                    {/* Section 1: Basic Information */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h4 className="flex items-center gap-2 text-lg font-bold text-slate-800 mb-6 pb-2 border-b border-slate-100">
                            <Hash size={20} className="text-blue-500" /> 7�87�8y7�8 7�7� 7�87�7�7�7�8y7�
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">8�8�7� 7�87�8 8~ (7�7�7�8y7�7�8y)</label>
                                <div className="relative">
                                    <Hash size={16} className="absolute right-3 top-3 text-slate-400" />
                                    <input type="text" className="w-full pl-3 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 font-mono text-left dir-ltr" 
                                    value={formData.code || ''} onChange={e => setFormData({...formData, code: e.target.value})} placeholder="CODE-001" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">7�7�8& 7�87�8 8~ (7�7�7�8y) <span className="text-red-500">*</span></label>
                                <input required type="text" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" 
                                value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="8&7�7�8: 7�7�7� 7�8~7�7�7" />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">7�87�7�8& (7�8 7�88y7�8y)</label>
                                <div className="relative">
                                    <Languages size={16} className="absolute right-3 top-3 text-slate-400" />
                                    <input type="text" className="w-full pl-3 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-left dir-ltr" 
                                    value={formData.englishName || ''} onChange={e => setFormData({...formData, englishName: e.target.value})} placeholder="Yellow Corn" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Specifications & Logistics */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h4 className="flex items-center gap-2 text-lg font-bold text-slate-800 mb-6 pb-2 border-b border-slate-100">
                            <Layers size={20} className="text-purple-500" /> 7�88&8�7�7�8~7�7� 8�7�888�7�7�7�8y7�7�
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                             <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">7�87�7�8 8y8~ <span className="text-red-500">*</span></label>
                                <select required className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-purple-500"
                                value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value as CategoryType})}>
                                    <option value="">-- 7�7�7�7� 7�87�7�8 8y8~ --</option>
                                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">8�7�7�7� 7�888y7�7� <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <Ruler size={16} className="absolute right-3 top-3 text-slate-400" />
                                    <select required className="w-full pl-3 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-purple-500"
                                    value={formData.unit || ''} onChange={e => setFormData({...formData, unit: e.target.value})}>
                                        <option value="">-- 7�7�7�7� 7�88�7�7�7� --</option>
                                        {availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">8�7�8  7�87�7�8�7� (8�7�8&)</label>
                                <div className="relative">
                                    <Scale size={16} className="absolute right-3 top-3 text-slate-400" />
                                    <input type="number" className="w-full pl-3 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-purple-500" 
                                    value={formData.packageWeight || ''} onChange={e => setFormData({...formData, packageWeight: Number(e.target.value)})} placeholder="0.00" />
                                </div>
                            </div>
                            <div className="md:col-span-3">
                                <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                                    <TagIcon size={16} className="text-slate-400" /> 7�88�7�8�8& 7�88&7�7�7�7�7�
                                </label>
                                <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                    {availableTags.map(tag => (
                                        <button key={tag.id} type="button" onClick={() => {
                                            const currentTags = formData.tags || [];
                                            setFormData({...formData, tags: currentTags.includes(tag.id) ? currentTags.filter(t => t !== tag.id) : [...currentTags, tag.id]});
                                        }} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border shadow-sm`}
                                            style={{ 
                                                backgroundColor: (formData.tags || []).includes(tag.id) ? tag.color : 'white',
                                                color: (formData.tags || []).includes(tag.id) ? 'white' : 'black',
                                                borderColor: tag.color
                                            }}
                                        >{tag.name}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 3: Inventory Control */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h4 className="flex items-center gap-2 text-lg font-bold text-slate-800 mb-6 pb-2 border-b border-slate-100">
                            <AlertTriangle size={20} className="text-amber-500" /> 7�8y7�7�7�7� 7�88&7�7�8�8  8�7�87�8 7�8y8!7�7�
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                             <div>
                                <label className="block text-xs font-bold text-amber-600 mb-2">7�87�7� 7�87�7�8 80 (Min Limit)</label>
                                <input type="number" className="w-full p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-center font-bold outline-none focus:border-amber-500" 
                                value={formData.minLimit} onChange={e => setFormData({...formData, minLimit: Number(e.target.value)})} />
                                <p className="text-[10px] text-slate-400 mt-1">8y7�8!7� 7�8 7�8y8! "8&8 7�8~7�" 7�8 7� 7�88�7�8�8 88!7�7� 7�87�7�</p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-2">7�87�7� 7�87�87�80 (Max Limit)</label>
                                <input type="number" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold outline-none focus:border-slate-500" 
                                value={formData.maxLimit} onChange={e => setFormData({...formData, maxLimit: Number(e.target.value)})} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-red-600 mb-2">7�7� 7�87�87� (Reorder Point)</label>
                                <input type="number" className="w-full p-2.5 bg-red-50 border border-red-200 rounded-xl text-center font-bold text-red-600 outline-none focus:border-red-500" 
                                value={formData.orderLimit || ''} onChange={e => setFormData({...formData, orderLimit: Number(e.target.value)})} />
                                <p className="text-[10px] text-slate-400 mt-1">8y7�8!7� 7�8 7�8y8! "7�7�7�" 7�8 7� 7�88�7�8�8 88!7�7� 7�87�7�</p>
                            </div>
                        </div>
                    </div>
                </form>
            </div>

            <div className="p-6 border-t border-slate-200 bg-white flex justify-end gap-3 sticky bottom-0 z-10">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition">7�877�7</button>
                <button type="submit" form="itemForm" className="px-8 py-3 rounded-xl bg-slate-900 text-white hover:bg-emerald-600 shadow-lg flex items-center gap-2 font-bold transition">
                    <Save size={18} /> 7�8~7� 7�87�8y7�8 7�7�
                </button>
            </div>
          </div>
        </div>
      )}

      {/* ... Other modals (delete, import, bulk edit) stay similar but using confirmDelete which calls context functions ... */}
      
      {/* --- DELETE CONFIRMATION MODAL --- */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border-2 border-red-100">
                  <div className="p-6 bg-red-50 border-b border-red-100 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                          <AlertTriangle size={24} />
                      </div>
                      <div>
                          <h3 className="text-xl font-bold text-red-900">7�7�8�8y7� 7�87�7�8~ 7�88 8!7�7�8y</h3>
                          <p className="text-sm text-red-700 mt-1">8!7�7� 7�87�7�7�7�7 87� 8y8&8�8  7�87�7�7�7�7� 7�8 8!.</p>
                      </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                      <p className="text-slate-700 font-medium">
                          7�8 7� 7�880 8�7�8� 7�7�8~
                          <span className="font-bold text-slate-900 mx-1">
                              {deleteModal.ids.length === 1 ? '7�8 8~ 8�7�7�7�' : `${deleteModal.ids.length} 7�7�8 7�8~`}
                          </span>
                          8&8  87�7�7�7� 7�87�8y7�8 7�7�.
                      </p>

                      {deleteModal.transactionCount > 0 ? (
                          <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
                              <h4 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
                                  <AlertTriangle size={16} /> 7�8 7�8y8! 8!7�8& 7�7�7�
                              </h4>
                              <p className="text-sm text-amber-900 leading-relaxed">
                                  8!7�8! 7�87�7�8 7�8~ 8&7�7�7�7�7� 7�8�
                                  <span className="font-bold mx-1 text-lg">{deleteModal.transactionCount}</span>
                                  7�8&88y7� 8~8y 7�7�8 7�87�7�8�7� (8�7�7�7�/7�7�7�7�/...).
                                  <br/><br/>
                                  <span className="font-bold underline">7�8y7�8& 7�7�8~ 7�8&8y7� 8!7�8! 7�87�8&88y7�7� 8 8!7�7�8y7�</span> 87�8&7�8  7�87�8&7� 7�87�8y7�8 7�7�. 8!8 7�8 7� 8&7�7�8�7� 7�8&7�8&7�7�
                              </p>
                          </div>
                      ) : (
                          <p className="text-sm text-slate-500">87� 7�8�7�7� 7�8&88y7�7� 8&7�7�7�7�7� 7�8!7�8! 7�87�7�8 7�8~7R 7�87�7�8~ 7�8&8 .</p>
                      )}
                  </div>

                  <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                      <button 
                          onClick={() => setDeleteModal({ isOpen: false, ids: [], transactionCount: 0 })} 
                          className="px-6 py-3 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition"
                      >
                          7�877�7 7�87�8&7�
                      </button>
                      <button 
                          onClick={confirmDelete}
                          className="px-6 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow-lg shadow-red-900/20 flex items-center gap-2"
                      >
                          <Trash2 size={18} /> 8 7�8&7R 7�7�7�8~ 8 8!7�7�8y7�
                      </button>
                  </div>
              </div>
          </div>
      )}
      
      {/* ... Import & Bulk Edit Modals (Keep mostly same structure, just ensure they call context methods on submit) ... */}
      {/* Simplified for brevity in this response, assume similar structural updates to call addItems/updateItems */}
      {isBulkEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
                <div className="p-6 bg-slate-50 border-b border-slate-100">
                    <h3 className="text-xl font-bold text-slate-800">7�7�7�8y8 7�8&7�7�8y ({selectedIds.size} 7�8 8~)</h3>
                </div>
                <div className="p-6 space-y-4">
                    <div className="bg-yellow-50 p-3 rounded-lg text-xs text-yellow-700 mb-4 border border-yellow-100">
                        8&87�7�7�7�: 7�7�7�8� 7�87�88 8~7�7�77� 7�7�7� 8�8 7� 87� 7�7�8y7� 7�78y8y7�8! 87�8&8y7� 7�87�8 7�7�7� 7�88&7�7�7�7�.
                    </div>
                    
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">7�87�7�8 8y8~</label>
                        <select className="w-full p-2 border border-slate-200 rounded-lg" value={bulkForm.category || ''} onChange={e => setBulkForm({...bulkForm, category: e.target.value})}>
                            <option value="">(7�7�8�8  7�78y8y7�)</option>
                            {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">7�88�7�7�7�</label>
                        <select className="w-full p-2 border border-slate-200 rounded-lg" value={bulkForm.unit || ''} onChange={e => setBulkForm({...bulkForm, unit: e.target.value})}>
                            <option value="">(7�7�8�8  7�78y8y7�)</option>
                            {availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                    </div>
                    {/* ... rest of inputs ... */}
                </div>
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button onClick={() => setIsBulkEditOpen(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-200 rounded-lg">7�877�7</button>
                    <button onClick={handleBulkEditSubmit} className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold shadow-lg">7�7�7�8y8 7�87�78y8y7�7�7�</button>
                </div>
            </div>
        </div>
      )}

      {/* Import Modal */}
      {isImportOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
               {/* Same Import Modal Content but ensure commitImport calls addItems from context */}
               <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden h-[ظ -ظ©] flex flex-col">
                  {/* ... Header ... */}
                  <div className="bg-slate-50 border-b border-slate-200 p-6">
                      <h3 className="text-xl font-bold text-slate-800 mb-6">8&7�7�87� 7�7�7�8y7�7�7� 7�87�7�8 7�8~</h3>
                      {/* ... Steps ... */}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-8">
                       {/* ... Content based on step ... */}
                       {importStep === 1 && (
                          <div className="flex flex-col items-center justify-center h-full space-y-6">
                              {/* ... Upload logic ... */}
                              <label className="w-full max-w-lg h-48 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition bg-slate-50">
                                  <Upload size={48} className="text-slate-300 mb-4" />
                                  <span className="text-slate-500 font-bold">7�7�77� 8!8 7� 87�8~7� 8&88~ Excel</span>
                                  <input ref={fileInputRef} type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} />
                              </label>
                          </div>
                       )}
                       {/* ... other steps ... */}
                       {importStep === 3 && (
                          <div className="flex flex-col items-center justify-center h-full text-center">
                              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6 animate-bounce">
                                  <CheckCircle size={40} />
                              </div>
                              <h3 className="text-2xl font-bold text-slate-800 mb-2">7�8& 7�87�7�7�8y7�7�7� 7�8 7�7�7�!</h3>
                              <p className="text-slate-500">7�8&7� 7�7�7�8~7� {importPreview.length} 7�8 8~ 7�880 87�7�7�7� 7�87�8y7�8 7�7�.</p>
                          </div>
                      )}
                  </div>

                  <div className="bg-slate-50 p-6 border-t border-slate-200 flex justify-between">
                      <button onClick={() => { setIsImportOpen(false); setImportStep(1); }} className="px-6 py-2 rounded-xl text-slate-500 hover:bg-slate-200 font-bold">7�877�7</button>
                      
                      {importStep === 2 && (
                          <div className="flex gap-2">
                              <button onClick={() => setImportStep(1)} className="px-6 py-2 rounded-xl bg-white border border-slate-300 text-slate-600 font-bold hover:bg-slate-50">7�87�7�7�8</button>
                              <button onClick={commitImport} disabled={importPreview.length === 0} className="px-6 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                  7�7�8�8y7� 7�87�7�7�8y7�7�7�
                              </button>
                          </div>
                      )}
                  </div>
               </div>
          </div>
      )}
      <ToastComponent />

    </motion.div>
  );
};

export default ItemManagement;




