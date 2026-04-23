import { OperationType } from '../types';

export const SYSTEM_OPERATION_TYPES: OperationType[] = ['وارد', 'صادر', 'انتاج', 'هالك', 'مرتجع'];

const OPERATION_TYPE_ALIASES: Array<{ canonical: OperationType; aliases: string[] }> = [
  {
    canonical: 'وارد',
    aliases: ['1', 'in', 'incoming', 'import', 'purchase', 'receive', 'receipt', 'وارد', 'استلام', 'ادخال', 'إدخال', 'شراء', 'مشتريات'],
  },
  {
    canonical: 'صادر',
    aliases: ['2', 'out', 'outgoing', 'export', 'sale', 'dispatch', 'consumption', 'صادر', 'صرف', 'بيع', 'مبيعات', 'خروج', 'تحويل_صادر'],
  },
  {
    canonical: 'انتاج',
    aliases: ['3', 'prod', 'production', 'manufacturing', 'انتاج', 'إنتاج', 'تصنيع'],
  },
  {
    canonical: 'هالك',
    aliases: ['4', 'waste', 'damaged', 'scrap', 'loss', 'هالك', 'تالف'],
  },
  {
    canonical: 'مرتجع',
    aliases: ['5', 'return', 'returned', 'مرتجع', 'إرجاع', 'ارجاع'],
  },
];

export const canonicalizeOperationType = (value: unknown): OperationType => {
  const text = String(value ?? '').trim();
  if (!text) return '' as OperationType;

  if (SYSTEM_OPERATION_TYPES.includes(text as OperationType)) {
    return text as OperationType;
  }

  const normalized = text.toLowerCase();
  for (const { canonical, aliases } of OPERATION_TYPE_ALIASES) {
    if (aliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
      return canonical;
    }
  }

  return text as OperationType;
};

export const isInboundOperationType = (value: unknown): boolean => {
  const canonical = canonicalizeOperationType(value);
  return canonical === 'وارد' || canonical === 'انتاج' || canonical === 'مرتجع';
};

export const isOutboundOperationType = (value: unknown): boolean => {
  const canonical = canonicalizeOperationType(value);
  return canonical === 'صادر' || canonical === 'هالك';
};

export const isProductionOperationType = (value: unknown): boolean => canonicalizeOperationType(value) === 'انتاج';

export const isWasteOperationType = (value: unknown): boolean => canonicalizeOperationType(value) === 'هالك';

export const isReturnOperationType = (value: unknown): boolean => canonicalizeOperationType(value) === 'مرتجع';