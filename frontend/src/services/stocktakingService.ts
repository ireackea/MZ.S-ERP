import { Item, StockCheck, Transaction } from '../types';
import { v4 as uuidv4 } from 'uuid';

function toSignedMovement(transaction: Transaction): number {
  if (transaction.type === 'وارد' || transaction.type === 'إنتاج') return transaction.quantity;
  if (transaction.type === 'صادر' || transaction.type === 'هالك') return -transaction.quantity;
  return 0;
}

function parseDate(dateValue: string): Date | null {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function getMonthPeriod(monthValue: string): { start: Date; end: Date } {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

export interface StocktakingComputationInput {
  item: Item;
  transactions: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  actualOpeningBalance?: number;
  actualCountedBalance: number;
}

export function computeMonthlyStocktaking(input: StocktakingComputationInput): StockCheck {
  const itemTransactions = input.transactions.filter((transaction) => transaction.itemId === input.item.id);

  let movementsIn = 0;
  let movementsOut = 0;
  let netInPeriod = 0;
  let netAfterPeriod = 0;

  itemTransactions.forEach((transaction) => {
    const txDate = parseDate(transaction.date);
    if (!txDate) return;

    const signedMovement = toSignedMovement(transaction);
    if (txDate >= input.periodStart && txDate <= input.periodEnd) {
      if (signedMovement >= 0) movementsIn += signedMovement;
      else movementsOut += Math.abs(signedMovement);
      netInPeriod += signedMovement;
      return;
    }

    if (txDate > input.periodEnd) {
      netAfterPeriod += signedMovement;
    }
  });

  const expectedSystemClosing = input.item.currentStock - netAfterPeriod;
  const openingSystemBalance = expectedSystemClosing - netInPeriod;
  const openingUsedBalance = input.actualOpeningBalance ?? openingSystemBalance;
  const expectedFinalBalance = openingUsedBalance + netInPeriod;
  const variance = input.actualCountedBalance - expectedFinalBalance;

  return {
    id: uuidv4(),
    date: new Date().toISOString(),
    itemId: input.item.id,
    systemBalance: expectedSystemClosing,
    actualBalance: input.actualCountedBalance,
    difference: variance,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    openingSystemBalance,
    openingActualBalance: openingUsedBalance,
    movementsIn,
    movementsOut,
    movementsNet: netInPeriod,
    expectedFinalBalance,
    varianceType: variance > 0 ? 'surplus' : variance < 0 ? 'shortage' : 'match',
    openingAdjusted: input.actualOpeningBalance !== undefined,
  };
}
