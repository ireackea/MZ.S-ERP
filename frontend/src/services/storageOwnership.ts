export type StorageOwnership =
  | 'BUSINESS_SERVER'
  | 'PRESENTATION_PREFERENCE'
  | 'OFFLINE_QUEUE'
  | 'LEGACY_UNSUPPORTED'
  | 'SECRET_FORBIDDEN';

export type StorageArea = 'localStorage' | 'sessionStorage' | 'indexedDB';

export type StorageInventoryEntry = {
  key: string;
  area: StorageArea;
  ownership: StorageOwnership;
  consumers: string[];
  migration?: string;
};

const entry = (
  key: string,
  area: StorageArea,
  ownership: StorageOwnership,
  consumers: string[],
  migration?: string,
): StorageInventoryEntry => ({ key, area, ownership, consumers, migration });

export const STORAGE_INVENTORY: StorageInventoryEntry[] = [
  entry('ff_inventory_store_v1', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_items', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_transactions', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_partners', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_orders', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_users', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_tags', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_units', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_categories', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_settings', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_formulas', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_stock_checks', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/storage.ts']),
  entry('feed_factory_monthly_stocktaking_sessions', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/monthlyStocktakingService.ts']),
  entry('feed_factory_iam_config', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/iamService.ts']),
  entry('feed_factory_notification_logs', 'localStorage', 'BUSINESS_SERVER', ['frontend/src/services/notificationService.ts']),
  entry('feed_factory_opening_balances', 'localStorage', 'LEGACY_UNSUPPORTED', ['frontend/src/services/legacy/openingBalanceService.ts'], 'Migrate through DATA-003, then remove active import.'),
  entry('feed_factory_unloading_rules', 'localStorage', 'LEGACY_UNSUPPORTED', ['frontend/src/services/unloadingRulesService.ts'], 'Migrate through unloading-rules API adapter, then remove.'),
  entry('feed_factory_unloading_rules_migrated_v1', 'localStorage', 'LEGACY_UNSUPPORTED', ['frontend/src/services/unloadingRulesService.ts'], 'Migration marker only; remove with the legacy adapter.'),
  entry('feed_factory_maintenance_mode', 'localStorage', 'LEGACY_UNSUPPORTED', [], 'FC-SEC-003: the client-side auth surface that wrote this key was removed.'),
  entry('feed_factory_audit_logs', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-AUD-001: removed; audit evidence is served from PostgreSQL via GET /audit/logs.'),
  entry('feed_factory_user_activity_logs', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-AUD-001: removed; client activity is posted to /audit/client-activity.'),
  entry('feed_factory_jwt_user', 'localStorage', 'SECRET_FORBIDDEN', ['frontend/src/services/authSession.ts'], 'Session identity belongs in the HttpOnly cookie/server session.'),
  entry('feed_factory_jwt_*', 'localStorage', 'SECRET_FORBIDDEN', ['frontend/src/services/authSession.ts'], 'Never persist tokens or session material.'),
  entry('feed_factory_auth_*', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-SEC-003: the client-side auth controller that held these was removed.'),
  entry('feed_factory_auth_credentials', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-SEC-003: removed with the legacy auth surface.'),
  entry('feed_factory_auth_attempts', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-SEC-003: removed; lockout state is server-side only.'),
  entry('feed_factory_auth_lockouts', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-SEC-003: removed; lockout state is server-side only.'),
  entry('feed_factory_auth_2fa_challenges', 'localStorage', 'SECRET_FORBIDDEN', [], 'FC-SEC-003: removed; 2FA challenges never lived in the browser.'),
  entry('feed_factory_current_session_id', 'localStorage', 'SECRET_FORBIDDEN', ['frontend/src/services/authSession.ts'], 'Server session authority only.'),
  entry('feed_factory_last_activity_at', 'localStorage', 'SECRET_FORBIDDEN', ['frontend/src/hooks/useSessionTimeout.ts'], 'Ephemeral security state; do not persist.'),
  entry('feed_factory_device_fingerprint', 'localStorage', 'SECRET_FORBIDDEN', ['frontend/src/services/deviceFingerprint.ts'], 'Security metadata is server/session scoped.'),
  entry('feed_factory_last_login_username', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/components/LoginV2.tsx']),
  entry('ff_theme_store', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/shared/store/theme.store.ts']),
  entry('ff_theme_preference_v1', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/components/ThemeSwitcher.tsx']),
  entry('server_user_theme_*', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/shared/api/theme.api.ts']),
  entry('ff_theme', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/systemResetService.ts']),
  entry('ff_lang', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/systemResetService.ts']),
  entry('ff_api_url', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/systemResetService.ts']),
  entry('ff_features', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/systemResetService.ts']),
  entry('ff_pw_first_visit', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/hooks/useOfflineSync.ts']),
  entry('ff_pw_prompt_shown', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/hooks/useOfflineSync.ts']),
  entry('items.categoryOrder', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/pages/items/ItemsSmartCatalog.tsx']),
  entry('print_presets_statement', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/components/Statement.tsx']),
  entry('feed_factory_appearance', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_report_config', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_operation_print_config', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_operation_print_templates', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_stocktaking_print_config', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_stocktaking_print_templates', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_opening_balance_report_config', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_item_sort_settings', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_user_grid_preferences', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_grid_display_policies', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_strict_empty_boot', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/storage.ts']),
  entry('feed_factory_system_reset_complete', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/systemResetService.ts']),
  entry('feed_factory_system_reset_message', 'localStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/services/systemResetService.ts']),
  entry('feed_factory_domain_migration_v1', 'localStorage', 'LEGACY_UNSUPPORTED', ['frontend/src/services/domainMigrationService.ts'], 'Migration marker only; remove after migration is verified.'),
  entry('feed_factory_bootstrap_metrics:last', 'sessionStorage', 'PRESENTATION_PREFERENCE', ['frontend/src/utils/bootstrapMetrics.ts']),
  entry('FeedFactoryMutationDB', 'indexedDB', 'OFFLINE_QUEUE', ['frontend/src/services/mutationQueueService.ts']),
  entry('mutationQueue', 'indexedDB', 'OFFLINE_QUEUE', ['frontend/src/services/mutationQueueService.ts']),
];

const matches = (key: string, entryKey: string) =>
  entryKey.endsWith('*') ? key.startsWith(entryKey.slice(0, -1)) : key === entryKey;

export const findStorageEntry = (key: string, area?: StorageArea) =>
  STORAGE_INVENTORY.find((candidate) => (!area || candidate.area === area) && matches(key, candidate.key));

export const assertStorageKeyAllowed = (key: string, area: StorageArea = 'localStorage') => {
  if (!findStorageEntry(key, area)) {
    throw new Error(`STORAGE_KEY_NOT_REGISTERED:${key}`);
  }
};
