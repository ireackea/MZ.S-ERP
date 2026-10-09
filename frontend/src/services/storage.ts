// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import { CATEGORIES as DEFAULT_CATEGORIES, INITIAL_ITEMS, UNITS } from '../constants';
import type {
	Formula,
	GridColumnPreference,
	Item,
	ItemSortSettings,
	OperationAppearance,
	ReportColumnConfig,
	StockCheck,
	SystemSettings,
	Tag,
	Transaction,
	UnloadingRule,
	User,
	UserGridPreference,
} from '../types';
import { canonicalizeOperationType } from '../utils/operationTypes';
import { assertStorageKeyAllowed } from './storageOwnership';
import { mergeColumns, OPENING_BALANCE_COLUMNS, STOCK_CARD_COLUMNS } from './reportColumns';

const INVENTORY_STORE_KEY = 'ff_inventory_store_v1';
const TRANSACTIONS_KEY = 'feed_factory_transactions';
const USERS_KEY = 'feed_factory_users';
const TAGS_KEY = 'feed_factory_tags';
const UNITS_KEY = 'feed_factory_units';
const CATEGORIES_KEY = 'feed_factory_categories';
const SETTINGS_KEY = 'feed_factory_settings';
const APPEARANCE_KEY = 'feed_factory_appearance';
const REPORT_CONFIG_KEY = 'feed_factory_report_config';
const OPERATION_PRINT_CONFIG_KEY = 'feed_factory_operation_print_config';
const OPERATION_PRINT_TEMPLATES_KEY = 'feed_factory_operation_print_templates';
const STOCKTAKING_PRINT_CONFIG_KEY = 'feed_factory_stocktaking_print_config';
const STOCKTAKING_PRINT_TEMPLATES_KEY = 'feed_factory_stocktaking_print_templates';
const OPENING_BALANCE_REPORT_CONFIG_KEY = 'feed_factory_opening_balance_report_config';
const FORMULAS_KEY = 'feed_factory_formulas';
const STOCK_CHECKS_KEY = 'feed_factory_stock_checks';
const USER_GRID_PREFERENCES_KEY = 'feed_factory_user_grid_preferences';
const GRID_DISPLAY_POLICIES_KEY = 'feed_factory_grid_display_policies';
const STRICT_EMPTY_BOOT_KEY = 'feed_factory_strict_empty_boot';

export type GridDisplayPolicy = {
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
	assertStorageKeyAllowed(key, 'localStorage');
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
	assertStorageKeyAllowed(key, 'localStorage');
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
	{ type: 'انتاج', color: '#3b82f6', fontSize: 'medium' },
	{ type: 'هالك', color: '#f59e0b', fontSize: 'medium' },
	{ type: 'مرتجع', color: '#0ea5e9', fontSize: 'medium' },
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
	assertStorageKeyAllowed(STRICT_EMPTY_BOOT_KEY, 'localStorage');
	if (!canUseStorage()) return;
	localStorage.removeItem(STRICT_EMPTY_BOOT_KEY);
};

export const getItems = (): Item[] => {
	const persistedSnapshot = readPersistedInventorySnapshot();
	const persistedItems = persistedSnapshot?.items;
	if (Array.isArray(persistedItems) && persistedItems.length > 0) {
		return persistedItems;
	}

	return readJson<Item[]>('feed_factory_items', INITIAL_ITEMS);
};

export const getTransactions = (): Transaction[] => readJson<Transaction[]>(TRANSACTIONS_KEY, []);
export const saveTransactions = (transactions: Transaction[]) => writeJson(TRANSACTIONS_KEY, transactions);

export const getUsers = (): User[] => {
	const persistedSnapshot = readPersistedInventorySnapshot();
	const persistedUsers = persistedSnapshot?.users;
	if (Array.isArray(persistedUsers) && persistedUsers.length > 0) {
		return persistedUsers;
	}

	return readJson<User[]>(USERS_KEY, defaultUsers());
};

export const saveUsers = (users: User[]) => writeJson(USERS_KEY, users);

export const getTags = (): Tag[] => readJson<Tag[]>(TAGS_KEY, []);
export const saveTags = (tags: Tag[]) => writeJson(TAGS_KEY, tags);

export const getUnits = (): string[] => {
	const persistedSnapshot = readPersistedInventorySnapshot();
	const persistedUnits = persistedSnapshot?.units;
	if (Array.isArray(persistedUnits) && persistedUnits.length > 0) {
		return uniqueStrings(persistedUnits);
	}

	return uniqueStrings(readJson<string[]>(UNITS_KEY, UNITS));
};

export const getCategories = (): string[] => {
	const persistedSnapshot = readPersistedInventorySnapshot();
	const persistedCategories = persistedSnapshot?.categories;
	if (Array.isArray(persistedCategories) && persistedCategories.length > 0) {
		return uniqueStrings(persistedCategories);
	}

	return uniqueStrings(readJson<string[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES));
};

export const getSettings = (): SystemSettings => readJson<SystemSettings>(SETTINGS_KEY, defaultSettings());
export const saveSettings = (settings: SystemSettings) => writeJson(SETTINGS_KEY, settings);

export const getAppearanceSettings = (): OperationAppearance[] => {
	const defaults = defaultAppearance();
	const merged = new Map(defaults.map((setting) => [canonicalizeOperationType(setting.type), { ...setting, type: canonicalizeOperationType(setting.type) }]));
	readJson<OperationAppearance[]>(APPEARANCE_KEY, defaults)
		.map((setting) => ({ ...setting, type: canonicalizeOperationType(setting.type) }))
		.forEach((setting) => merged.set(setting.type, setting));
	return defaults.map((setting) => merged.get(canonicalizeOperationType(setting.type)) || setting);
};
export const saveAppearanceSettings = (settings: OperationAppearance[]) => writeJson(
	APPEARANCE_KEY,
	settings.map((setting) => ({ ...setting, type: canonicalizeOperationType(setting.type) })),
);

/**
 * Gate 4.5 — folded onto the catalogue on the way out, not on the way in.
 *
 * This returned the stored array raw, so a key written by an older release reached
 * the caller and the panel rendered it as a checkbox for a column the report cannot
 * draw. `mergeColumns` also de-duplicates first, which is what repairs a save that
 * was corrupted into holding a key twice.
 */
export const getReportConfig = (): ReportColumnConfig[] =>
	mergeColumns(STOCK_CARD_COLUMNS, readJson<ReportColumnConfig[] | undefined>(REPORT_CONFIG_KEY, undefined));
export const saveReportConfig = (config: ReportColumnConfig[]) => writeJson(REPORT_CONFIG_KEY, config);

export const getOperationPrintConfig = (): Record<string, unknown> => readJson<Record<string, unknown>>(OPERATION_PRINT_CONFIG_KEY, {});
export const saveOperationPrintConfig = (config: Record<string, unknown>) => writeJson(OPERATION_PRINT_CONFIG_KEY, config);

export const getOperationPrintTemplates = (): Array<Record<string, unknown>> => readJson<Array<Record<string, unknown>>>(OPERATION_PRINT_TEMPLATES_KEY, []);
export const saveOperationPrintTemplates = (templates: Array<Record<string, unknown>>) => writeJson(OPERATION_PRINT_TEMPLATES_KEY, templates);

export const getStocktakingPrintConfig = (): Record<string, unknown> => readJson<Record<string, unknown>>(STOCKTAKING_PRINT_CONFIG_KEY, {});
export const saveStocktakingPrintConfig = (config: Record<string, unknown>) => writeJson(STOCKTAKING_PRINT_CONFIG_KEY, config);

export const getStocktakingPrintTemplates = (): Array<Record<string, unknown>> => readJson<Array<Record<string, unknown>>>(STOCKTAKING_PRINT_TEMPLATES_KEY, []);
export const saveStocktakingPrintTemplates = (templates: Array<Record<string, unknown>>) => writeJson(STOCKTAKING_PRINT_TEMPLATES_KEY, templates);

/** Same shape, for the valuation report. Kept apart from the movement report above. */
export const getOpeningBalanceReportConfig = (): ReportColumnConfig[] =>
	mergeColumns(OPENING_BALANCE_COLUMNS, readJson<ReportColumnConfig[] | undefined>(OPENING_BALANCE_REPORT_CONFIG_KEY, undefined));

export const saveOpeningBalanceReportConfig = (config: ReportColumnConfig[]) => writeJson(OPENING_BALANCE_REPORT_CONFIG_KEY, config);


export const getStockChecks = (): StockCheck[] => readJson<StockCheck[]>(STOCK_CHECKS_KEY, []);
export const saveStockChecks = (checks: StockCheck[]) => writeJson(STOCK_CHECKS_KEY, checks);

export const getFormulas = (): Formula[] => readJson<Formula[]>(FORMULAS_KEY, []);
export const saveFormulas = (formulas: Formula[]) => writeJson(FORMULAS_KEY, formulas);

// FC-AUD-001 — the localStorage audit log (`feed_factory_audit_logs`) was
// removed. Audit evidence that a user can edit or clear is not evidence; the
// server-side trail lives in PostgreSQL and is read via GET /audit/logs.

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
