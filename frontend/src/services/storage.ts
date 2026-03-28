// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import { CATEGORIES as DEFAULT_CATEGORIES, INITIAL_ITEMS, UNITS } from '../constants';
import type {
	AuditLog,
	Formula,
	GridColumnPreference,
	Item,
	ItemSortSettings,
	OperationAppearance,
	Order,
	Partner,
	ReportColumnConfig,
	StockCheck,
	SystemSettings,
	Tag,
	Transaction,
	UnloadingRule,
	User,
	UserGridPreference,
} from '../types';

const INVENTORY_STORE_KEY = 'ff_inventory_store_v1';
const TRANSACTIONS_KEY = 'feed_factory_transactions';
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
const STOCK_CHECKS_KEY = 'feed_factory_stock_checks';
const AUDIT_LOGS_KEY = 'feed_factory_audit_logs';
const USER_GRID_PREFERENCES_KEY = 'feed_factory_user_grid_preferences';
const GRID_DISPLAY_POLICIES_KEY = 'feed_factory_grid_display_policies';
const STRICT_EMPTY_BOOT_KEY = 'feed_factory_strict_empty_boot';

type GridDisplayPolicy = {
	forceUnified: boolean;
};

type PersistedInventorySnapshot = Partial<{
	state: Partial<{
		items: Item[];
		users: User[];
		units: string[];
		categories: string[];
	}>;
}>;

const canUseStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const readJson = <T,>(key: string, fallback: T): T => {
	if (!canUseStorage()) return fallback;
	const raw = localStorage.getItem(key);
	if (!raw) return fallback;

	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
};

const writeJson = <T,>(key: string, value: T) => {
	if (!canUseStorage()) return;
	localStorage.setItem(key, JSON.stringify(value));
};

const readPersistedInventorySnapshot = (): PersistedInventorySnapshot['state'] => {
	const snapshot = readJson<PersistedInventorySnapshot>(INVENTORY_STORE_KEY, {});
	return snapshot.state ?? {};
};

const uniqueStrings = (values: string[]) => Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const defaultUsers = (): User[] => [];

const defaultSettings = (): SystemSettings => ({
	companyName: 'MZ.S-ERP',
	currency: 'EGP',
	address: '',
	phone: '',
});

const defaultAppearance = (): OperationAppearance[] => ([
	{ type: 'وارد', color: '#10b981', fontSize: 'medium' },
	{ type: 'صادر', color: '#ef4444', fontSize: 'medium' },
	{ type: 'إنتاج', color: '#3b82f6', fontSize: 'medium' },
	{ type: 'هالك', color: '#f59e0b', fontSize: 'medium' },
]);

const defaultReportConfig = (): ReportColumnConfig[] => ([
	{ key: 'date', label: 'التاريخ', isVisible: true },
	{ key: 'warehouseInvoice', label: 'رقم إذن المخزن', isVisible: true },
	{ key: 'code', label: 'الكود', isVisible: true },
	{ key: 'item', label: 'الصنف', isVisible: true },
	{ key: 'type', label: 'نوع الحركة', isVisible: true },
	{ key: 'quantity', label: 'الكمية', isVisible: true },
	{ key: 'unit', label: 'الوحدة', isVisible: true },
	{ key: 'partner', label: 'المورد أو المستلم', isVisible: true },
	{ key: 'notes', label: 'ملاحظات', isVisible: true },
]);

const defaultOpeningBalanceReportConfig = (): ReportColumnConfig[] => ([
	{ key: 'item', label: 'الصنف', isVisible: true },
	{ key: 'quantity', label: 'الكمية', isVisible: true },
	{ key: 'unitCost', label: 'تكلفة الوحدة', isVisible: true },
	{ key: 'unit', label: 'الوحدة', isVisible: true },
	{ key: 'category', label: 'التصنيف', isVisible: true },
	{ key: 'code', label: 'الكود', isVisible: true },
]);

const parseGridConfig = (value?: string): GridColumnPreference[] => {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as GridColumnPreference[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

const normalizeGridColumns = (columns: GridColumnPreference[]) =>
	[...columns]
		.sort((left, right) => left.order - right.order)
		.map((column, index) => ({
			...column,
			order: index,
			width: Math.max(80, Number(column.width || 120)),
			locked: column.locked ?? false,
		}));

const mergeGridColumns = (base: GridColumnPreference[], overlay?: GridColumnPreference[]) => {
	const overlayByKey = new Map((overlay || []).map((column) => [column.key, column]));

	return normalizeGridColumns(
		base.map((baseColumn, index) => {
			const saved = overlayByKey.get(baseColumn.key);
			const merged: GridColumnPreference = {
				...baseColumn,
				visible: saved?.visible ?? baseColumn.visible,
				order: Number.isFinite(saved?.order) ? Number(saved?.order) : index,
				width: Number.isFinite(saved?.width) ? Math.max(80, Number(saved?.width)) : Math.max(80, Number(baseColumn.width || 120)),
				frozen: saved?.frozen ?? baseColumn.frozen,
				label: saved?.label || baseColumn.label,
				locked: saved?.locked ?? baseColumn.locked ?? false,
			};

			if (baseColumn.locked) {
				merged.visible = true;
				merged.order = baseColumn.order;
				merged.locked = true;
			}

			return merged;
		})
	);
};

export const clearStrictEmptyBootFlag = () => {
	if (!canUseStorage()) return;
	localStorage.removeItem(STRICT_EMPTY_BOOT_KEY);
};

export const getItems = (): Item[] => {
	const persistedItems = readPersistedInventorySnapshot().items;
	if (Array.isArray(persistedItems) && persistedItems.length > 0) {
		return persistedItems;
	}

	return readJson<Item[]>('feed_factory_items', INITIAL_ITEMS);
};

export const getTransactions = (): Transaction[] => readJson<Transaction[]>(TRANSACTIONS_KEY, []);
export const saveTransactions = (transactions: Transaction[]) => writeJson(TRANSACTIONS_KEY, transactions);

export const getPartners = (): Partner[] => readJson<Partner[]>(PARTNERS_KEY, []);
export const savePartners = (partners: Partner[]) => writeJson(PARTNERS_KEY, partners);

export const getOrders = (): Order[] => readJson<Order[]>(ORDERS_KEY, []);
export const saveOrders = (orders: Order[]) => writeJson(ORDERS_KEY, orders);

export const getUsers = (): User[] => {
	const persistedUsers = readPersistedInventorySnapshot().users;
	if (Array.isArray(persistedUsers) && persistedUsers.length > 0) {
		return persistedUsers;
	}

	return readJson<User[]>(USERS_KEY, defaultUsers());
};

export const saveUsers = (users: User[]) => writeJson(USERS_KEY, users);

export const getTags = (): Tag[] => readJson<Tag[]>(TAGS_KEY, []);
export const saveTags = (tags: Tag[]) => writeJson(TAGS_KEY, tags);

export const getUnits = (): string[] => {
	const persistedUnits = readPersistedInventorySnapshot().units;
	if (Array.isArray(persistedUnits) && persistedUnits.length > 0) {
		return uniqueStrings(persistedUnits);
	}

	return uniqueStrings(readJson<string[]>(UNITS_KEY, UNITS));
};

export const getCategories = (): string[] => {
	const persistedCategories = readPersistedInventorySnapshot().categories;
	if (Array.isArray(persistedCategories) && persistedCategories.length > 0) {
		return uniqueStrings(persistedCategories);
	}

	return uniqueStrings(readJson<string[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES));
};

export const getSettings = (): SystemSettings => readJson<SystemSettings>(SETTINGS_KEY, defaultSettings());
export const saveSettings = (settings: SystemSettings) => writeJson(SETTINGS_KEY, settings);

export const getAppearanceSettings = (): OperationAppearance[] => readJson<OperationAppearance[]>(APPEARANCE_KEY, defaultAppearance());
export const saveAppearanceSettings = (settings: OperationAppearance[]) => writeJson(APPEARANCE_KEY, settings);

export const getReportConfig = (): ReportColumnConfig[] => readJson<ReportColumnConfig[]>(REPORT_CONFIG_KEY, defaultReportConfig());
export const saveReportConfig = (config: ReportColumnConfig[]) => writeJson(REPORT_CONFIG_KEY, config);

export const getOpeningBalanceReportConfig = (): ReportColumnConfig[] => {
	const defaults = defaultOpeningBalanceReportConfig();
	const stored = readJson<ReportColumnConfig[]>(OPENING_BALANCE_REPORT_CONFIG_KEY, defaults);
	if (!Array.isArray(stored) || stored.length === 0) return defaults;

	const allowed = new Set(defaults.map((column) => column.key));
	const filtered = stored.filter((column) => allowed.has(column.key));
	const missing = defaults.filter((column) => !filtered.some((entry) => entry.key === column.key));
	return [...filtered, ...missing];
};

export const saveOpeningBalanceReportConfig = (config: ReportColumnConfig[]) => writeJson(OPENING_BALANCE_REPORT_CONFIG_KEY, config);

export const getItemSortSettings = (): ItemSortSettings => {
	const fallback: ItemSortSettings = { mode: 'manual_locked', manualOrder: [] };
	const stored = readJson<ItemSortSettings>(ITEM_SORT_SETTINGS_KEY, fallback);

	return {
		mode: stored?.mode || fallback.mode,
		manualOrder: Array.isArray(stored?.manualOrder) ? stored.manualOrder.map((entry) => String(entry)) : [],
	};
};

export const saveItemSortSettings = (settings: ItemSortSettings) => writeJson(ITEM_SORT_SETTINGS_KEY, settings);

export const getUnloadingRules = (): UnloadingRule[] => {
	const rules = readJson<UnloadingRule[]>(UNLOADING_RULES_KEY, []);
	return rules.map((rule) => ({
		...rule,
		rule_name: rule.rule_name ?? rule.name ?? '',
		allowed_duration_minutes: Number(rule.allowed_duration_minutes ?? rule.durationMinutes ?? 0),
		penalty_rate_per_minute: Number(rule.penalty_rate_per_minute ?? rule.delayPenaltyPerMinute ?? 0),
		is_active: rule.is_active ?? true,
	}));
};

export const saveUnloadingRules = (rules: UnloadingRule[]) => writeJson(UNLOADING_RULES_KEY, rules);

export const getStockChecks = (): StockCheck[] => readJson<StockCheck[]>(STOCK_CHECKS_KEY, []);
export const saveStockChecks = (checks: StockCheck[]) => writeJson(STOCK_CHECKS_KEY, checks);

export const getFormulas = (): Formula[] => readJson<Formula[]>(FORMULAS_KEY, []);
export const saveFormulas = (formulas: Formula[]) => writeJson(FORMULAS_KEY, formulas);

export const getAuditLogs = (): AuditLog[] => readJson<AuditLog[]>(AUDIT_LOGS_KEY, []);
export const addAuditLog = (log: Omit<AuditLog, 'id' | 'timestamp'>) => {
	const current = getAuditLogs();
	const next: AuditLog = {
		...log,
		id: crypto.randomUUID(),
		timestamp: Date.now(),
	};
	writeJson(AUDIT_LOGS_KEY, [...current.slice(-499), next]);
};

export const getUserGridPreferences = (): UserGridPreference[] => readJson<UserGridPreference[]>(USER_GRID_PREFERENCES_KEY, []);
export const saveUserGridPreferences = (rows: UserGridPreference[]) => writeJson(USER_GRID_PREFERENCES_KEY, rows);

export const getGridDisplayPolicies = (): Record<string, GridDisplayPolicy> => readJson<Record<string, GridDisplayPolicy>>(GRID_DISPLAY_POLICIES_KEY, {});

export const getGridDisplayPolicy = (moduleKey: string): GridDisplayPolicy => {
	const policies = getGridDisplayPolicies();
	return policies[moduleKey] || { forceUnified: false };
};

export const upsertGridDisplayPolicy = (moduleKey: string, policy: GridDisplayPolicy) => {
	const policies = getGridDisplayPolicies();
	policies[moduleKey] = { forceUnified: !!policy.forceUnified };
	writeJson(GRID_DISPLAY_POLICIES_KEY, policies);
};

export const getGridPreferenceForUser = (userId: string, moduleKey: string, fallback: GridColumnPreference[]): GridColumnPreference[] => {
	const rows = getUserGridPreferences();
	const exact = rows.find((row) => row.user_id === userId && row.module_key === moduleKey);
	const defaultRow = rows.find((row) => row.user_id === '0' && row.module_key === moduleKey);
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

export const upsertGridPreferenceForUser = (userId: string, moduleKey: string, config: GridColumnPreference[]) => {
	const rows = getUserGridPreferences();
	const payload: UserGridPreference = {
		user_id: userId,
		module_key: moduleKey,
		config_json: JSON.stringify(normalizeGridColumns(config)),
	};
	const existingIndex = rows.findIndex((row) => row.user_id === userId && row.module_key === moduleKey);

	if (existingIndex >= 0) {
		rows[existingIndex] = payload;
	} else {
		rows.push(payload);
	}

	saveUserGridPreferences(rows);
};

export const resetGridPreferenceForUser = (userId: string, moduleKey: string) => {
	const rows = getUserGridPreferences().filter((row) => !(row.user_id === userId && row.module_key === moduleKey));
	saveUserGridPreferences(rows);
};
