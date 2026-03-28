import { GridColumnPreference } from '../types';

export interface GridModuleDefinition {
  key: string;
  label: string;
  columns: GridColumnPreference[];
}

export const GRID_MODULE_DEFINITIONS: GridModuleDefinition[] = [
  {
    key: 'statement_grid',
    label: 'كشف الحركة المتقدم',
    columns: [
      { key: 'select', label: 'تحديد', visible: true, order: 0, width: 64, frozen: true },
      { key: 'rowNumber', label: '#', visible: true, order: 1, width: 64, frozen: true },
      { key: 'date', label: 'التاريخ', visible: true, order: 2, width: 130, frozen: false },
      { key: 'type', label: 'نوع الحركة', visible: true, order: 3, width: 120, frozen: false },
      { key: 'warehouseInvoice', label: 'فاتورة المخزن', visible: true, order: 4, width: 140, frozen: false },
      { key: 'supplierInvoice', label: 'فاتورة المورد', visible: true, order: 5, width: 140, frozen: false },
      { key: 'itemName', label: 'اسم الصنف', visible: true, order: 6, width: 220, frozen: true },
      { key: 'itemCode', label: 'كود الصنف', visible: true, order: 7, width: 120, frozen: false },
      { key: 'unit', label: 'الوحدة', visible: true, order: 8, width: 90, frozen: false },
      { key: 'quantity', label: 'الكمية', visible: true, order: 9, width: 120, frozen: false },
      { key: 'price', label: 'السعر', visible: true, order: 10, width: 120, frozen: false },
      { key: 'total', label: 'الإجمالي', visible: true, order: 11, width: 130, frozen: false },
      { key: 'grossWeight', label: 'صافي السهل', visible: true, order: 12, width: 140, frozen: false },
      { key: 'netWeight', label: 'صافي المورد', visible: true, order: 13, width: 130, frozen: false },
      { key: 'difference', label: 'الفرق', visible: true, order: 14, width: 110, frozen: false },
      { key: 'packageCount', label: 'العبوات', visible: true, order: 15, width: 110, frozen: false },
      { key: 'weightSlip', label: 'نموذج الوزن', visible: true, order: 16, width: 130, frozen: false },
      { key: 'supplierOrReceiver', label: 'المورد/العميل', visible: true, order: 17, width: 200, frozen: false },
      { key: 'warehouseId', label: 'المستودع', visible: true, order: 18, width: 130, frozen: false },
      { key: 'truckNumber', label: 'الشاحنة', visible: true, order: 19, width: 110, frozen: false },
      { key: 'trailerNumber', label: 'الجرار', visible: true, order: 20, width: 110, frozen: false },
      { key: 'driverName', label: 'السائق', visible: true, order: 21, width: 150, frozen: false },
      { key: 'entryTime', label: 'دخول', visible: true, order: 22, width: 90, frozen: false },
      { key: 'exitTime', label: 'خروج', visible: true, order: 23, width: 90, frozen: false },
      { key: 'unloadingRule', label: 'قاعدة التفريغ', visible: true, order: 24, width: 170, frozen: false },
      { key: 'delayMinutes', label: 'دقائق التأخير', visible: true, order: 25, width: 130, frozen: false },
      { key: 'delayAmount', label: 'مبلغ التأخير', visible: true, order: 26, width: 130, frozen: false },
      { key: 'notes', label: 'ملاحظات', visible: true, order: 27, width: 220, frozen: false },
      { key: 'actions', label: 'إجراءات', visible: true, order: 28, width: 110, frozen: false },
    ],
  },
  {
    key: 'inventory_batch',
    label: 'إدخال المخزون المتعدد',
    columns: [
      { key: 'rowNumber', label: '#', visible: true, order: 0, width: 56, frozen: true },
      { key: 'date', label: 'التاريخ', visible: true, order: 1, width: 120, frozen: false },
      { key: 'type', label: 'العملية', visible: true, order: 2, width: 100, frozen: false },
      { key: 'warehouseInvoice', label: 'فاتورة المخزن', visible: true, order: 3, width: 120, frozen: false },
      { key: 'supplierOrReceiver', label: 'المورد / المستلم', visible: true, order: 4, width: 220, frozen: false },
      { key: 'supplierInvoice', label: 'فاتورة مورد', visible: true, order: 5, width: 100, frozen: false },
      { key: 'truckNumber', label: 'شاحنة', visible: true, order: 6, width: 90, frozen: false },
      { key: 'trailerNumber', label: 'جرار', visible: true, order: 7, width: 90, frozen: false },
      { key: 'driverName', label: 'السائق', visible: true, order: 8, width: 120, frozen: false },
      { key: 'weightSlip', label: 'نموذج الوزن', visible: true, order: 9, width: 120, frozen: false },
      { key: 'itemId', label: 'الصنف', visible: true, order: 10, width: 220, frozen: false },
      { key: 'quantity', label: 'صافي السهل', visible: true, order: 11, width: 120, frozen: false },
      { key: 'supplierNet', label: 'صافي المورد', visible: true, order: 12, width: 120, frozen: false },
      { key: 'packageCount', label: 'العبوات', visible: true, order: 13, width: 120, frozen: false },
      { key: 'entryTime', label: 'دخول', visible: true, order: 14, width: 90, frozen: false },
      { key: 'exitTime', label: 'خروج', visible: true, order: 15, width: 90, frozen: false },
      { key: 'unloadingRuleId', label: 'قاعدة التفريغ', visible: true, order: 16, width: 160, frozen: false },
      { key: 'delayPenalty', label: 'الغرامة', visible: true, order: 17, width: 120, frozen: false },
      { key: 'saveAction', label: 'حفظ', visible: true, order: 18, width: 72, frozen: true },
    ],
  },
  {
    key: 'inventory_log',
    label: 'سجل عمليات المخزون',
    columns: [
      { key: 'select', label: 'تحديد', visible: true, order: 0, width: 56, frozen: true },
      { key: 'invoiceCounter', label: '#', visible: true, order: 1, width: 110, frozen: true },
      { key: 'dateInvoice', label: 'التاريخ / الفاتورة', visible: true, order: 2, width: 220, frozen: true },
      { key: 'item', label: 'الصنف', visible: true, order: 3, width: 180, frozen: false },
      { key: 'weights', label: 'الأوزان', visible: true, order: 4, width: 220, frozen: false },
      { key: 'logistics', label: 'اللوجستيات', visible: true, order: 5, width: 220, frozen: false },
      { key: 'timeFine', label: 'الوقت والغرامات', visible: true, order: 6, width: 220, frozen: false },
      { key: 'actions', label: 'إجراءات', visible: true, order: 7, width: 110, frozen: false },
    ],
  },
  {
    key: 'opening_balance_table',
    label: 'جدول أرصدة بداية المدة',
    columns: [
      { key: 'item', label: 'الصنف', visible: true, order: 0, width: 240, frozen: true },
      { key: 'code', label: 'الكود', visible: true, order: 1, width: 140, frozen: false },
      { key: 'unit', label: 'الوحدة', visible: true, order: 2, width: 120, frozen: false },
      { key: 'openingBalance', label: 'رصيد بداية المدة', visible: true, order: 3, width: 200, frozen: false },
    ],
  },
];

export const getGridModuleDefinition = (moduleKey: string): GridModuleDefinition | undefined => {
  return GRID_MODULE_DEFINITIONS.find(module => module.key === moduleKey);
};
