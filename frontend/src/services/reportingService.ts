
import { Transaction, Item } from '../types';
import { getItems } from './storage';
import { getFinancialYearFromDate, getOpeningQuantity } from './openingBalanceService';
import { canonicalizeOperationType, isInboundOperationType } from '../utils/operationTypes';

export interface StockCardRow extends Transaction {
  // Detailed breakdown
  importQty: number; // وارد
  returnQty: number; // مرتجع
  prodQty: number;   // إنتاج
  exportQty: number; // صادر
  wasteQty: number;  // هالك
  
  runningBalance: number;
}

export interface StockCardResult {
  item: Item;
  openingBalance: number;
  closingBalance: number;
  
  // Totals
  totalImport: number;
  totalReturn: number;
  totalProduction: number;
  totalExport: number;
  totalWaste: number;
  
  rows: StockCardRow[];
}

/**
 * Calculates the Stock Card (Kardex) for a specific item within a date range.
 * Enhanced to split Import/Return/Production and Export/Waste.
 */
export const generateStockCard = (
  itemId: string,
  startDate: string,
  endDate: string,
  allTransactions: Transaction[],
  allItems?: Item[]
): StockCardResult | null => {
  const items = Array.isArray(allItems) && allItems.length > 0 ? allItems : getItems();
  const targetItem = items.find(i => i.id === itemId);
  
  if (!targetItem) return null;

  // Sort transactions by date ASC, then by timestamp ASC to ensure chronological order
  const financialYear = getFinancialYearFromDate(startDate);
  const sortedTxns = [...allTransactions]
    .filter(t => t.itemId === itemId)
    .filter(t => getFinancialYearFromDate(t.date) === financialYear)
    .sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        return a.timestamp - b.timestamp;
    });

  const baseOpeningBalance = getOpeningQuantity(itemId, financialYear);
  let runningBalance = baseOpeningBalance;
  let openingBalance = baseOpeningBalance;
  
  let totalImport = 0;
  let totalReturn = 0;
  let totalProduction = 0;
  let totalExport = 0;
  let totalWaste = 0;

  const rows: StockCardRow[] = [];

  // Iterate through ALL history to calculate running balance correctly
  for (const t of sortedTxns) {
    // FC-DATA-001 — the row arrives as a decimal string. Convert once, here, so
    // every aggregation below works on a number without a dozen scattered casts
    // and without any of them being forgotten.
    const qty = Number(t.quantity);
    
    // Determine Flow Direction for Balance Calculation
    // In: Import (وارد), Return (مرتجع), Production (انتاج)
    // Out: Export (صادر), Waste (هالك)
    const canonicalType = canonicalizeOperationType(t.type);
    const isAdd = isInboundOperationType(canonicalType);
    
    if (isAdd) {
        runningBalance += qty;
    } else {
        runningBalance -= qty;
    }

    // Logic to separate "Before Period" and "During Period"
    if (t.date < startDate) {
      // This transaction contributes to Opening Balance
      openingBalance = runningBalance;
    } else if (t.date >= startDate && t.date <= endDate) {
      // This transaction is IN the report period
      
      let importQty = 0;
      let returnQty = 0;
      let prodQty = 0;
      let exportQty = 0;
      let wasteQty = 0;

      // Categorize specifically
        switch (canonicalType) {
          case 'وارد':
              importQty = qty;
              totalImport += qty;
              break;
            case 'مرتجع':
              returnQty = qty;
              totalReturn += qty;
              break;
          case 'انتاج':
              prodQty = qty;
              totalProduction += qty;
              break;
          case 'صادر':
              exportQty = qty;
              totalExport += qty;
              break;
          case 'هالك':
              wasteQty = qty;
              totalWaste += qty;
              break;
      }

      rows.push({
        ...t,
        importQty,
        returnQty,
        prodQty,
        exportQty,
        wasteQty,
        runningBalance,
      });
    }
  }

  return {
    item: targetItem,
    openingBalance,
    closingBalance: rows.length > 0 ? rows[rows.length - 1].runningBalance : openingBalance,
    totalImport,
    totalReturn,
    totalProduction,
    totalExport,
    totalWaste,
    rows,
  };
};
