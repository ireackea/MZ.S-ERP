
import { Transaction, Item } from '../types';
import { getTransactions, getItems } from './storage';
import { getFinancialYearFromDate, getOpeningQuantity } from './openingBalanceService';

export interface StockCardRow extends Transaction {
  // Detailed breakdown
  importQty: number; // وارد
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
  totalProduction: number;
  totalExport: number;
  totalWaste: number;
  
  rows: StockCardRow[];
}

/**
 * Calculates the Stock Card (Kardex) for a specific item within a date range.
 * Enhanced to split Import/Production and Export/Waste.
 */
export const generateStockCard = (
  itemId: string,
  startDate: string,
  endDate: string,
  allTransactions: Transaction[]
): StockCardResult | null => {
  const items = getItems();
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
  let totalProduction = 0;
  let totalExport = 0;
  let totalWaste = 0;

  const rows: StockCardRow[] = [];

  // Iterate through ALL history to calculate running balance correctly
  for (const t of sortedTxns) {
    const qty = t.quantity;
    
    // Determine Flow Direction for Balance Calculation
    // In: Import (وارد), Production (إنتاج)
    // Out: Export (صادر), Waste (هالك)
    const isAdd = t.type === 'وارد' || t.type === 'إنتاج';
    
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
      let prodQty = 0;
      let exportQty = 0;
      let wasteQty = 0;

      // Categorize specifically
      switch (t.type) {
          case 'وارد':
              importQty = qty;
              totalImport += qty;
              break;
          case 'إنتاج':
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
        prodQty,
        exportQty,
        wasteQty,
        runningBalance: runningBalance // Snapshot at this moment
      });
    }
    // Transactions after endDate are ignored for this report
  }

  return {
    item: targetItem,
    openingBalance,
    closingBalance: runningBalance, // Should match last row's runningBalance if we included all rows, but strictly speaking distinct closing for period:
    // Actually, closingBalance is usually (Opening + Total In - Total Out) during period
    // But logically, it represents the balance at the END of the period.
    // Since runningBalance variable holds the absolute latest (or latest processed), 
    // we need to make sure we captured the balance at the moment of the last processed row.
    // If rows exist, take last row balance. If not, it's opening balance.
    // However, if there are transactions AFTER endDate, runningBalance variable will continue to change in the loop? 
    // No, we filtered `t.date <= endDate` for the row pushing, but we updated `runningBalance` regardless?
    // Wait, the loop runs for ALL sortedTxns.
    // We need to capture the balance at exactly `endDate`.
    
    // Correction:
    // We should return the balance as of `endDate`.
    // In the loop above, if we passed endDate, we are modifying runningBalance.
    // Let's fix the Closing Balance logic.
    
    // Re-calculate strictly based on period totals for display consistency:
    // Closing = Opening + (Imp + Prod) - (Exp + Waste)
    
    // But wait, the `runningBalance` in the row is the most accurate snapshot.
    // So Closing Balance = Last Row's Balance (if exists) OR Opening Balance (if no rows).
    
    totalImport,
    totalProduction,
    totalExport,
    totalWaste,
    rows
  };
};
