// ENTERPRISE FIX: Phase 6.5 - Absolute 100% Cleanup & Global Verification - 2026-03-13
import { Item, Transaction, StockCheck, Partner, Order, User, Tag, SystemSettings, OperationAppearance, ReportColumnConfig, UnloadingRule, Formula, AuditLog, GridColumnPreference, UserGridPreference, ItemSortSettings } from '../../types';
import { CATEGORIES as DEFAULT_CATEGORIES, INITIAL_ITEMS, UNITS } from '../../constants';
import { cache } from './cacheService';
import { eventBus, TOPICS } from './eventBus'; // Import Event Bus

const ITEMS_KEY = 'feed_factory_items';
const TRANSACTIONS_KEY = 'feed_factory_transactions';
const STOCK_CHECKS_KEY = 'feed_factory_stock_checks';
const PARTNERS_KEY = 'feed_factory_partners';
const ORDERS_KEY = 'feed_factory_orders';
const USERS_KEY = 'feed_factory_users';
const TAGS_KEY = 'feed_factory_tags';
const UNITS_KEY = 'feed_factory_units';
const CATEGORIES_KEY = 'feed_factory_categories'; 
const SETTINGS_KEY = 'feed_factory_settings';
const APPEARANCE_KEY = 'feed_factory_appearance';
const REPORT_CONFIG_KEY = 'feed_factory_report_config';
const OPENING_BALANCE_REPORT_CONFIG_KEY = 'feed_factory_opening_balance_report_config';
const ITEM_SORT_SETTINGS_KEY = 'feed_factory_item_sort_settings';
const UNLOADING_RULES_KEY = 'feed_factory_unloading_rules';
const FORMULAS_KEY = 'feed_factory_formulas';
const INVENTORY_LEDGER_KEY = 'feed_factory_inventory_ledger';
const STRICT_EMPTY_BOOT_KEY = 'feed_factory_strict_empty_boot';
const USER_GRID_PREFERENCES_KEY = 'feed_factory_user_grid_preferences';
const GRID_DISPLAY_POLICIES_KEY = 'feed_factory_grid_display_policies';

function isStrictEmptyBootEnabled(): boolean {
  return localStorage.getItem(STRICT_EMPTY_BOOT_KEY) === '1';
}

// --- Helper to fetch from Storage or Cache (Read-Through Strategy) ---
function getFromStorage<T>(key: string, fallback: T): T {
  const cached = cache.get<T>(key);
  if (cached) return cached;
  const data = localStorage.getItem(key);
  const parsed = data ? JSON.parse(data) : fallback;
  cache.set(key, parsed);
  return parsed;
}

function saveToStorage<T>(key: string, data: T) {
  cache.set(key, data);
  localStorage.setItem(key, JSON.stringify(data));
}

// --- Items ---
export const getItems = (): Item[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<Item[]>(ITEMS_KEY, []);
  }

  let items = getFromStorage<Item[]>(ITEMS_KEY, INITIAL_ITEMS);
  let hasChanges = false;
  items = items.map((item, index) => {
    if (!item.code) {
      hasChanges = true;
      return { ...item, code: `SYS-${1000 + index}` };
    }
    return item;
  });
  if (hasChanges) saveToStorage(ITEMS_KEY, items);
  return items;
};

export const saveItems = (items: Item[]) => {
  saveToStorage(ITEMS_KEY, items);
  cache.invalidate('analytics_stock_summary'); 
  // EVENT: Publish that items were updated
  eventBus.publish(TOPICS.STOCK_UPDATED, { count: items.length });
};

// --- Transactions (High Volume Data) ---
export const getTransactions = (): Transaction[] => {
  return getFromStorage<Transaction[]>(TRANSACTIONS_KEY, []);
};

export const saveTransactions = (transactions: Transaction[]) => {
  saveToStorage(TRANSACTIONS_KEY, transactions);
  cache.invalidate('analytics_summary');
  cache.invalidate('analytics_chart_data');
  
  // EVENT: Publish new transactions event
  // This allows the "Analytics Service" or "Audit Service" to react without being coupled here
  const latestTransaction = transactions[transactions.length - 1];
  if (latestTransaction) {
      eventBus.publish(TOPICS.TRANSACTION_ADDED, latestTransaction);
  }
};

// --- Analytics Engine ---
export const getAnalyticsSummary = () => {
    interface AnalyticsData {
        totalTransactions: number;
        todayCount: number;
        lowStockCount: number;
        lastUpdated: number;
    }
    const cachedStats = cache.get<AnalyticsData>('analytics_summary');
    if (cachedStats) return cachedStats;

    const transactions = getTransactions();
    const items = getItems();
    const today = new Date().toISOString().split('T')[0];
    const todayTransactions = transactions.filter(t => t.date === today);
    const lowStockCount = items.filter(
        (item) => item.orderLimit !== undefined && item.currentStock <= item.orderLimit
    ).length;

    const stats: AnalyticsData = {
        totalTransactions: transactions.length,
        todayCount: todayTransactions.length,
        lowStockCount,
        lastUpdated: Date.now()
    };
    cache.set('analytics_summary', stats);
    return stats;
};

export const getPartners = (): Partner[] => getFromStorage(PARTNERS_KEY, []);
export const savePartners = (partners: Partner[]) => {
    saveToStorage(PARTNERS_KEY, partners);
    eventBus.publish(TOPICS.PARTNER_CREATED, partners[partners.length -1]);
};

export const getOrders = (): Order[] => getFromStorage(ORDERS_KEY, []);
export const saveOrders = (orders: Order[]) => {
    saveToStorage(ORDERS_KEY, orders);
    // EVENT: Sales Service publishing "Order Created"
    const latestOrder = orders[orders.length - 1];
    if (latestOrder) {
        eventBus.publish(TOPICS.ORDER_CREATED, latestOrder);
    }
};

export const getUsers = (): User[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<User[]>(USERS_KEY, []);
  }

  const defaultUsers: User[] = [
    { id: '1', name: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�', role: 'admin', roleId: 'admin', active: true, status: 'active', scope: 'all', email: 'admin@factory.com', twoFactorEnabled: false, twoFaEnabled: false, mustChangePassword: false },
    { id: 'hashem-admin', name: '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�', role: 'admin', roleId: 'admin', active: true, status: 'active', scope: 'all', email: 'hashem@factory.com', twoFactorEnabled: false, twoFaEnabled: false, mustChangePassword: false }
  ];

  let hasHashemUpdates = false;
  const users = getFromStorage<User[]>(USERS_KEY, defaultUsers).map(user => {
    const isHashem = user.id === 'hashem-admin' || user.email === 'hashem@factory.com' || user.name === '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�';
    const normalizedUser = {
    ...user,
    roleId: user.roleId ?? user.role,
    scope: user.scope ?? 'all',
    userBranch: user.userBranch ?? user.scope ?? 'all',
    status: user.status ?? (user.active ? 'active' : 'suspended'),
    twoFactorEnabled: user.twoFactorEnabled ?? user.twoFaEnabled ?? false,
    twoFaEnabled: user.twoFaEnabled ?? user.twoFactorEnabled ?? false,
    mustChangePassword: user.mustChangePassword ?? false
    };

    if (!isHashem) return normalizedUser;

    const enforcedHashem: User = {
      ...normalizedUser,
      id: 'hashem-admin',
      name: '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�',
      email: 'hashem@factory.com',
      role: 'admin',
      roleId: 'admin',
      active: true,
      status: 'active',
      scope: 'all',
      userBranch: normalizedUser.userBranch ?? 'all',
    };

    const changed =
      normalizedUser.id !== enforcedHashem.id ||
      normalizedUser.role !== 'admin' ||
      normalizedUser.roleId !== 'admin' ||
      normalizedUser.active !== true ||
      normalizedUser.status !== 'active' ||
      normalizedUser.email !== 'hashem@factory.com' ||
      normalizedUser.name !== '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�' ||
      normalizedUser.scope !== 'all';

    if (changed) hasHashemUpdates = true;
    return enforcedHashem;
  });
  const hasHashem = users.some(u => u.name === '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�' || u.email === 'hashem@factory.com');

  if (!hasHashem) {
    const updatedUsers = [...users, defaultUsers[1]];
    saveToStorage(USERS_KEY, updatedUsers);
    return updatedUsers;
  }

  if (hasHashemUpdates) {
    saveToStorage(USERS_KEY, users);
  }

  return users;
};
export const saveUsers = (users: User[]) => saveToStorage(USERS_KEY, users);

export const getTags = (): Tag[] => getFromStorage(TAGS_KEY, []);
export const saveTags = (tags: Tag[]) => saveToStorage(TAGS_KEY, tags);

export const getUnits = (): string[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<string[]>(UNITS_KEY, []);
  }
  return getFromStorage(UNITS_KEY, UNITS);
};
export const saveUnits = (units: string[]) => saveToStorage(UNITS_KEY, units);

export const getCategories = (): string[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<string[]>(CATEGORIES_KEY, []);
  }
  return getFromStorage(CATEGORIES_KEY, DEFAULT_CATEGORIES);
};
export const saveCategories = (categories: string[]) => saveToStorage(CATEGORIES_KEY, categories);

export const getSettings = (): SystemSettings => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage(SETTINGS_KEY, {
      companyName: '',
      currency: '',
      address: '',
      phone: '',
    });
  }
  return getFromStorage(SETTINGS_KEY, {
      companyName: '7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
      currency: 'EGP',
      address: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
      phone: ''
  });
};
export const saveSettings = (settings: SystemSettings) => saveToStorage(SETTINGS_KEY, settings);

export const getAppearanceSettings = (): OperationAppearance[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<OperationAppearance[]>(APPEARANCE_KEY, []);
  }
  return getFromStorage(APPEARANCE_KEY, [
      { type: '7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', color: '#10b981', fontSize: 'medium' },
      { type: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', color: '#ef4444', fontSize: 'medium' },
      { type: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', color: '#3b82f6', fontSize: 'medium' },
      { type: '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�����', color: '#eab308', fontSize: 'medium' },
  ]);
};
export const saveAppearanceSettings = (settings: OperationAppearance[]) => saveToStorage(APPEARANCE_KEY, settings);

export const getReportConfig = (): ReportColumnConfig[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<ReportColumnConfig[]>(REPORT_CONFIG_KEY, []);
  }
  return getFromStorage(REPORT_CONFIG_KEY, [
      { key: 'date', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'warehouseInvoice', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�#�⬑"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'code', label: '7�"�7�"�7�"�#�����7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'item', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'type', label: '7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'quantity', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�����7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'unit', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
      { key: 'partner', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�/7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�', isVisible: true },
      { key: 'logistics', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�#�⬑"�#���9 ', isVisible: false },
      { key: 'notes', label: '7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
  ]);
};
export const saveReportConfig = (config: ReportColumnConfig[]) => saveToStorage(REPORT_CONFIG_KEY, config);

export const getOpeningBalanceReportConfig = (): ReportColumnConfig[] => {
  if (isStrictEmptyBootEnabled()) {
    return getFromStorage<ReportColumnConfig[]>(OPENING_BALANCE_REPORT_CONFIG_KEY, []);
  }
  const defaults: ReportColumnConfig[] = [
    { key: 'item', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
    { key: 'quantity', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�����7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
    { key: 'unitCost', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�����7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
    { key: 'unit', label: '7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�⬩7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
    { key: 'category', label: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
    { key: 'code', label: '7�"�7�"�7�"�#�����7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�', isVisible: true },
  ];

  const stored = getFromStorage<ReportColumnConfig[]>(OPENING_BALANCE_REPORT_CONFIG_KEY, defaults);
  if (!Array.isArray(stored) || stored.length === 0) return defaults;
  const allowed = new Set(defaults.map((c) => c.key));
  const normalized = stored.filter((c) => allowed.has(c.key));
  const missing = defaults.filter((c) => !normalized.find((n) => n.key === c.key));
  return [...normalized, ...missing];
};
export const saveOpeningBalanceReportConfig = (config: ReportColumnConfig[]) =>
  saveToStorage(OPENING_BALANCE_REPORT_CONFIG_KEY, config);

export const getItemSortSettings = (): ItemSortSettings => {
  const fallback: ItemSortSettings = {
    mode: 'manual_locked',
    manualOrder: [],
  };
  const stored = getFromStorage<ItemSortSettings>(ITEM_SORT_SETTINGS_KEY, fallback);
  return {
    mode: stored?.mode || 'manual_locked',
    manualOrder: Array.isArray(stored?.manualOrder) ? stored.manualOrder.map((id) => String(id)) : [],
  };
};

export const saveItemSortSettings = (settings: ItemSortSettings) => {
  const safe: ItemSortSettings = {
    mode: settings?.mode || 'manual_locked',
    manualOrder: Array.isArray(settings?.manualOrder) ? settings.manualOrder.map((id) => String(id)) : [],
  };
  saveToStorage(ITEM_SORT_SETTINGS_KEY, safe);
};

export const getUnloadingRules = (): UnloadingRule[] => {
  const rules = getFromStorage<UnloadingRule[]>(UNLOADING_RULES_KEY, []);
  return rules.map((rule) => ({
    ...rule,
    rule_name: rule.rule_name ?? rule.name ?? '',
    allowed_duration_minutes: Number(rule.allowed_duration_minutes ?? rule.durationMinutes ?? 0),
    penalty_rate_per_minute: Number(rule.penalty_rate_per_minute ?? rule.delayPenaltyPerMinute ?? 0),
    is_active: rule.is_active ?? true,
  }));
};
export const saveUnloadingRules = (rules: UnloadingRule[]) => {
  const normalized = rules.map((rule) => ({
    ...rule,
    rule_name: rule.rule_name ?? rule.name ?? '',
    allowed_duration_minutes: Number(rule.allowed_duration_minutes ?? rule.durationMinutes ?? 0),
    penalty_rate_per_minute: Number(rule.penalty_rate_per_minute ?? rule.delayPenaltyPerMinute ?? 0),
    is_active: rule.is_active ?? true,
  }));
  saveToStorage(UNLOADING_RULES_KEY, normalized);
};

export const getStockChecks = (): StockCheck[] => getFromStorage(STOCK_CHECKS_KEY, []);
export const saveStockChecks = (checks: StockCheck[]) => saveToStorage(STOCK_CHECKS_KEY, checks);

// Formulas
export const getFormulas = (): Formula[] => getFromStorage(FORMULAS_KEY, []);
export const saveFormulas = (formulas: Formula[]) => saveToStorage(FORMULAS_KEY, formulas);

// Audit Logs are no longer persisted in legacy storage.
export const getAuditLogs = (): AuditLog[] => [];
export const addAuditLog = (_log: Omit<AuditLog, 'id' | 'timestamp'>): void => undefined;

// Ledger
export interface LedgerEntry {
    eventId: string;
    timestamp: number;
    itemId: string;
    eventType: 'IN' | 'OUT' | 'ADJUST' | 'PRODUCTION';
    quantityChange: number;
    runningBalance: number;
    referenceId: string;
    userId?: string;
}

export const getLedger = (): LedgerEntry[] => getFromStorage(INVENTORY_LEDGER_KEY, []);

export const appendToLedger = (entry: Omit<LedgerEntry, 'runningBalance' | 'eventId' | 'timestamp'>) => {
    const ledger = getLedger();
    const previousBalance = ledger.filter(l => l.itemId === entry.itemId).reduce((acc, curr) => acc + curr.quantityChange, 0);
    const newBalance = previousBalance + entry.quantityChange;

    const newEntry: LedgerEntry = {
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
        runningBalance: newBalance,
        ...entry
    };

    const updatedLedger = [...ledger, newEntry];
    saveToStorage(INVENTORY_LEDGER_KEY, updatedLedger);
    return newBalance;
};

// Universal Grid Preferences
export const getUserGridPreferences = (): UserGridPreference[] => getFromStorage<UserGridPreference[]>(USER_GRID_PREFERENCES_KEY, []);

export const saveUserGridPreferences = (rows: UserGridPreference[]) => saveToStorage(USER_GRID_PREFERENCES_KEY, rows);

interface GridDisplayPolicy {
  forceUnified: boolean;
}

const parseGridConfig = (value?: string): GridColumnPreference[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as GridColumnPreference[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeGridColumns = (columns: GridColumnPreference[]) => {
  return [...columns]
    .sort((a, b) => a.order - b.order)
    .map((col, index) => ({
      ...col,
      order: index,
      width: Math.max(80, Number(col.width || 120)),
      locked: col.locked ?? false,
    }));
};

const mergeGridColumns = (base: GridColumnPreference[], overlay?: GridColumnPreference[]) => {
  const baseByKey = new Map(base.map(col => [col.key, col]));
  const overlayByKey = new Map((overlay || []).map(col => [col.key, col]));

  const merged = base.map((baseCol, index) => {
    const saved = overlayByKey.get(baseCol.key);
    const next: GridColumnPreference = {
      ...baseCol,
      visible: saved?.visible ?? baseCol.visible,
      order: Number.isFinite(saved?.order) ? Number(saved?.order) : index,
      width: Number.isFinite(saved?.width) ? Math.max(80, Number(saved?.width)) : Math.max(80, Number(baseCol.width || 120)),
      frozen: saved?.frozen ?? baseCol.frozen,
      label: saved?.label || baseCol.label,
      locked: saved?.locked ?? baseCol.locked ?? false,
    };

    if (baseCol.locked) {
      next.visible = true;
      next.order = baseCol.order;
      next.locked = true;
    }

    return next;
  });

  return normalizeGridColumns(merged);
};

export const getGridDisplayPolicies = (): Record<string, GridDisplayPolicy> =>
  getFromStorage<Record<string, GridDisplayPolicy>>(GRID_DISPLAY_POLICIES_KEY, {});

export const getGridDisplayPolicy = (moduleKey: string): GridDisplayPolicy => {
  const policies = getGridDisplayPolicies();
  return policies[moduleKey] || { forceUnified: false };
};

export const upsertGridDisplayPolicy = (moduleKey: string, policy: GridDisplayPolicy) => {
  const policies = getGridDisplayPolicies();
  policies[moduleKey] = {
    forceUnified: !!policy.forceUnified,
  };
  saveToStorage(GRID_DISPLAY_POLICIES_KEY, policies);
};

export const resetGridPreferencesForModule = (moduleKey: string, preserveDefault = true) => {
  const rows = getUserGridPreferences().filter((row) => {
    if (row.module_key !== moduleKey) return true;
    if (preserveDefault && row.user_id === '0') return true;
    return false;
  });
  saveUserGridPreferences(rows);
};

export const getGridPreferenceForUser = (
  userId: string,
  moduleKey: string,
  fallback: GridColumnPreference[]
): GridColumnPreference[] => {
  const rows = getUserGridPreferences();
  const exact = rows.find(row => row.user_id === userId && row.module_key === moduleKey);
  const defaultRow = rows.find(row => row.user_id === '0' && row.module_key === moduleKey);
  const defaultParsed = parseGridConfig(defaultRow?.config_json);
  const exactParsed = parseGridConfig(exact?.config_json);
  const fallbackNormalized = normalizeGridColumns(fallback);
  const baseColumns = defaultParsed.length > 0 ? mergeGridColumns(fallbackNormalized, defaultParsed) : fallbackNormalized;
  const policy = getGridDisplayPolicy(moduleKey);

  if (policy.forceUnified && userId !== '0') {
    return baseColumns;
  }

  if (!exactParsed.length) {
    return baseColumns;
  }

  return mergeGridColumns(baseColumns, exactParsed);
};

export const upsertGridPreferenceForUser = (
  userId: string,
  moduleKey: string,
  config: GridColumnPreference[]
) => {
  const rows = getUserGridPreferences();
  const normalized = normalizeGridColumns(config);
  const payload: UserGridPreference = {
    user_id: userId,
    module_key: moduleKey,
    config_json: JSON.stringify(normalized),
  };
  const idx = rows.findIndex(row => row.user_id === userId && row.module_key === moduleKey);
  if (idx >= 0) {
    rows[idx] = payload;
  } else {
    rows.push(payload);
  }
  saveUserGridPreferences(rows);
};

export const resetGridPreferenceForUser = (userId: string, moduleKey: string) => {
  const rows = getUserGridPreferences().filter(row => !(row.user_id === userId && row.module_key === moduleKey));
  saveUserGridPreferences(rows);
};
