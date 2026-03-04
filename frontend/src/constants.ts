import { CategoryType, Item, UnitType, OperationType } from './types';

export const CATEGORIES: CategoryType[] = [
  'المركزات',
  'الخام والمواد المضافة',
  'الأكياس والخامات',
  'مستلزمات إنتاج',
  'تحت التصنيع',
];

export const UNITS: UnitType[] = [
  'طن متري',
  'كيلو',
  'جرام',
  'متر',
  'قطعة',
  'علبة',
  'كرتونة',
];

export const OPERATION_TYPES: OperationType[] = [
  'وارد',
  'صادر',
  'تالف',
  'تحويل_صادر',
];

export const INITIAL_ITEMS: Item[] = [
  {
    id: '1',
    code: '1001',
    name: 'ذرة صفراء مستوردة',
    englishName: 'Yellow Corn',
    category: 'الخام والمواد المضافة',
    unit: 'كيلو',
    minLimit: 10,
    maxLimit: 1000,
    orderLimit: 50,
    currentStock: 120,
    lastUpdated: new Date().toISOString(),
    // Sustainability Data
    co2PerUnit: 350, // kg CO2 per Ton (Approx for Corn production + shipping)
    sustainabilityRating: 'B',
  },
  {
    id: '2',
    code: '2005',
    name: 'كسبة فول صويا 44%',
    englishName: 'Soybean Meal 44%',
    category: 'تحت التصنيع',
    unit: 'كيلو',
    minLimit: 5,
    maxLimit: 500,
    orderLimit: 20,
    currentStock: 15,
    lastUpdated: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    // Sustainability Data
    co2PerUnit: 800, // kg CO2 per Ton (Higher due to processing)
    sustainabilityRating: 'C',
  },
  {
    id: '3',
    code: '3010',
    name: 'مركز بادئ لحم 23%',
    englishName: 'Broiler Starter 23%',
    category: 'تحت التصنيع',
    unit: 'كيلو',
    minLimit: 10,
    maxLimit: 200,
    orderLimit: 15,
    currentStock: 50,
    lastUpdated: new Date().toISOString(),
    // Sustainability Data
    co2PerUnit: 450, // Optimized formula
    sustainabilityRating: 'A',
  }
];
