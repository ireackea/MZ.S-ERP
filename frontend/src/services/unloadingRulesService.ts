import apiClient from '@api/client';
import type { UnloadingRule, UnloadingRuleDraft } from '../types';

const LEGACY_UNLOADING_RULES_KEY = 'feed_factory_unloading_rules';
const LEGACY_UNLOADING_RULES_MIGRATION_KEY = 'feed_factory_unloading_rules_migrated_v1';

const handleApiError = (error: any): Error => {
  const status = error?.response?.status;
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'حدث خطأ غير متوقع أثناء معالجة قواعد التفريغ.';
  const requestUrl = String(error?.config?.url || '');
  const isUnloadingRulesRoute = /\/unloading-rules(?:\/|$)/i.test(requestUrl);
  const isMissingEndpoint = /^Cannot\s+(GET|POST|PUT|PATCH|DELETE)\s+/i.test(String(message));
  const isMissingTable =
    status === 500 &&
    /(unloading_rules|unloadingRule|does not exist|relation .* does not exist|table .* does not exist)/i.test(String(message));

  if (status === 401) {
    return new Error('خطأ في المصادقة (401): الجلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى.');
  }

  if (isMissingTable) {
    return new Error('خدمة قواعد التفريغ تعمل، لكن جدولها غير موجود بعد في قاعدة البيانات. نفّذ Prisma migration ثم أعد تشغيل الخادم.');
  }

  if (status === 404) {
    if (isUnloadingRulesRoute && isMissingEndpoint) {
      return new Error('خدمة قواعد التفريغ غير مفعلة على الخادم الحالي. أعد تشغيل backend أو انشر آخر التعديلات ثم أعد المحاولة.');
    }
    return new Error('قاعدة التفريغ المطلوبة غير موجودة أو تم حذفها.');
  }

  return new Error(message);
};

const unwrapData = <T,>(payload: any): T => (payload?.data ?? payload) as T;

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const normalizeUnloadingRule = (rule: any): UnloadingRule => ({
  id: String(rule?.id || ''),
  rule_name: String(rule?.rule_name ?? rule?.name ?? ''),
  allowed_duration_minutes: Number(rule?.allowed_duration_minutes ?? rule?.durationMinutes ?? 0),
  penalty_rate_per_minute: Number(rule?.penalty_rate_per_minute ?? rule?.delayPenaltyPerMinute ?? 0),
  is_active: rule?.is_active ?? true,
  createdAt: rule?.createdAt ? String(rule.createdAt) : undefined,
  updatedAt: rule?.updatedAt ? String(rule.updatedAt) : undefined,
});

const normalizeLegacyDraft = (rule: any): UnloadingRuleDraft | null => {
  const ruleName = String(rule?.rule_name ?? rule?.name ?? '').trim();
  const allowedDuration = Number(rule?.allowed_duration_minutes ?? rule?.durationMinutes ?? 0);
  const penaltyRate = Number(rule?.penalty_rate_per_minute ?? rule?.delayPenaltyPerMinute ?? 0);

  if (!ruleName || !Number.isFinite(allowedDuration) || allowedDuration <= 0 || !Number.isFinite(penaltyRate) || penaltyRate < 0) {
    return null;
  }

  return {
    rule_name: ruleName,
    allowed_duration_minutes: Math.trunc(allowedDuration),
    penalty_rate_per_minute: penaltyRate,
    is_active: rule?.is_active ?? true,
  };
};

const readLegacyUnloadingRules = (): UnloadingRuleDraft[] => {
  if (!canUseStorage()) return [];

  const raw = window.localStorage.getItem(LEGACY_UNLOADING_RULES_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const unique = new Map<string, UnloadingRuleDraft>();
    parsed.forEach((entry) => {
      const normalized = normalizeLegacyDraft(entry);
      if (!normalized) return;
      unique.set(normalized.rule_name.toLowerCase(), normalized);
    });
    return [...unique.values()];
  } catch {
    return [];
  }
};

const markLegacyMigrationComplete = () => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(LEGACY_UNLOADING_RULES_MIGRATION_KEY, 'done');
  window.localStorage.removeItem(LEGACY_UNLOADING_RULES_KEY);
};

export const fetchUnloadingRules = async (): Promise<UnloadingRule[]> => {
  try {
    const response = await apiClient.get('/unloading-rules');
    const rows = unwrapData<any[]>(response.data);
    return Array.isArray(rows) ? rows.map(normalizeUnloadingRule) : [];
  } catch (error) {
    throw handleApiError(error);
  }
};

export const createUnloadingRuleInApi = async (draft: UnloadingRuleDraft): Promise<UnloadingRule> => {
  try {
    const response = await apiClient.post('/unloading-rules', draft);
    return normalizeUnloadingRule(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

export const updateUnloadingRuleInApi = async (id: string, draft: UnloadingRuleDraft): Promise<UnloadingRule> => {
  try {
    const response = await apiClient.put(`/unloading-rules/${encodeURIComponent(String(id))}`, draft);
    return normalizeUnloadingRule(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

export const deleteUnloadingRulesInApi = async (ids: string[]): Promise<void> => {
  try {
    await apiClient.post('/unloading-rules/delete', { ids });
  } catch (error) {
    throw handleApiError(error);
  }
};

export const migrateLegacyUnloadingRules = async (): Promise<UnloadingRule[]> => {
  if (!canUseStorage()) return [];
  if (window.localStorage.getItem(LEGACY_UNLOADING_RULES_MIGRATION_KEY) === 'done') return [];

  const legacyRules = readLegacyUnloadingRules();
  if (legacyRules.length === 0) {
    markLegacyMigrationComplete();
    return [];
  }

  for (const rule of legacyRules) {
    await createUnloadingRuleInApi(rule);
  }

  const migratedRules = await fetchUnloadingRules();
  markLegacyMigrationComplete();
  return migratedRules;
};