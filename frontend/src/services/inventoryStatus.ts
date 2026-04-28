export type InventoryStatusKey = 'good' | 'warning' | 'critical';

type InventoryStatusInput = {
  balance: number;
  minLimit: number;
  orderLimit?: number;
};

type InventoryStatus = {
  key: InventoryStatusKey;
  isBelowMin: boolean;
  isBelowOrder: boolean;
  requiresAttention: boolean;
};

const toNumber = (value: unknown, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const getInventoryStatus = ({ balance, minLimit, orderLimit }: InventoryStatusInput): InventoryStatus => {
  const normalizedBalance = toNumber(balance, 0);
  const normalizedMinLimit = toNumber(minLimit, 0);
  const normalizedOrderLimit = orderLimit == null ? undefined : toNumber(orderLimit, 0);

  const isBelowOrder = normalizedOrderLimit != null && normalizedBalance <= normalizedOrderLimit;
  const isBelowMin = normalizedBalance <= normalizedMinLimit;

  if (isBelowOrder) {
    return {
      key: 'critical',
      isBelowMin,
      isBelowOrder,
      requiresAttention: true,
    };
  }

  if (isBelowMin) {
    return {
      key: 'warning',
      isBelowMin,
      isBelowOrder,
      requiresAttention: true,
    };
  }

  return {
    key: 'good',
    isBelowMin: false,
    isBelowOrder: false,
    requiresAttention: false,
  };
};