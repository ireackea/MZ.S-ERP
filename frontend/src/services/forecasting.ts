
import { Item, Transaction } from '../types';
import { differenceInDays, addDays, format } from 'date-fns';

export interface ForecastResult {
  itemId: string;
  itemName: string;
  currentStock: number;
  burnRate: number; // Average daily consumption
  daysRemaining: number;
  predictedDate: string | null; // ISO Date or null if infinite
  status: 'critical' | 'warning' | 'safe' | 'stable';
  suggestion: string;
}

export const generateForecast = (items: Item[], transactions: Transaction[], lookbackDays: number = 30): ForecastResult[] => {
  const today = new Date();
  
  // 1. Calculate Consumption per Item over the lookback period
  const consumptionMap = new Map<string, number>();
  
  transactions.forEach(t => {
    // Only consider OUT operations (Sales, Production, Export)
    if (t.type === 'صادر' || t.type === 'إنتاج') {
        const txDate = new Date(t.date);
        const diff = differenceInDays(today, txDate);
        
        if (diff <= lookbackDays && diff >= 0) {
            const current = consumptionMap.get(t.itemId) || 0;
            consumptionMap.set(t.itemId, current + t.quantity);
        }
    }
  });

  // 2. Generate Forecasts
  const forecasts: ForecastResult[] = items.map(item => {
    const totalConsumption = consumptionMap.get(item.id) || 0;
    
    // Calculate Average Daily Burn Rate
    // If consumption is 0, burn rate is 0.
    const burnRate = totalConsumption / lookbackDays;
    
    let daysRemaining = Infinity;
    let predictedDate: string | null = null;
    let status: ForecastResult['status'] = 'stable';
    let suggestion = 'حركة المخزون مستقرة';

    if (burnRate > 0) {
        daysRemaining = item.currentStock / burnRate;
        const targetDate = addDays(today, Math.floor(daysRemaining));
        predictedDate = format(targetDate, 'yyyy-MM-dd');

        // Logic for status
        if (daysRemaining <= 7) {
            status = 'critical';
            suggestion = 'اطلب فوراً! الكمية تكفي لأقل من أسبوع';
        } else if (daysRemaining <= 15) {
            status = 'warning';
            suggestion = 'يستحسن بدء إجراءات الشراء';
        } else {
            status = 'safe';
            suggestion = `الكمية تكفي حتى ${format(targetDate, 'dd/MM/yyyy')}`;
        }
    } else {
        if (item.currentStock === 0) {
            status = 'critical';
            suggestion = 'المخزون نفذ بالفعل';
            daysRemaining = 0;
        } else {
            status = 'stable';
            suggestion = 'لا يوجد استهلاك حديث';
        }
    }

    return {
        itemId: item.id,
        itemName: item.name,
        currentStock: item.currentStock,
        burnRate,
        daysRemaining,
        predictedDate,
        status,
        suggestion
    };
  });

  // Sort by risk (lowest days remaining first)
  return forecasts.sort((a, b) => a.daysRemaining - b.daysRemaining);
};
