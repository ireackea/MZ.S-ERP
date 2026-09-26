import { partnersApi } from './partnersApi';
import { ordersApi } from './ordersApi';
import { stocktakingApi } from './stocktakingApi';
import type { Order, Partner } from '../types';

const MIGRATION_VERSION = 1;
const MIGRATION_MARKER = `feed_factory_domain_migration_v${MIGRATION_VERSION}`;
const MIGRATION_IDEMPOTENCY_PREFIX = `domain-migration-v${MIGRATION_VERSION}`;
const LEGACY_KEYS = ['feed_factory_partners', 'feed_factory_orders', 'feed_factory_monthly_stocktaking_sessions'];

type LegacyStocktakingSession = {
  monthKey: string;
  itemRecords?: Record<string, { actualCount?: number; notes?: string }>;
  closed?: boolean;
  archivedPdfName?: string;
  archivedPdfMime?: string;
  archivedPdfData?: string;
};

const readLegacy = <T,>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export async function migrateLegacyDomains(): Promise<{ partners: number; orders: number; stocktaking: number }> {
  if (localStorage.getItem(MIGRATION_MARKER) === 'done') return { partners: 0, orders: 0, stocktaking: 0 };

  const legacyPartners = readLegacy<Partner[]>('feed_factory_partners', []);
  const legacyOrders = readLegacy<Order[]>('feed_factory_orders', []);
  const legacyStocktaking = readLegacy<LegacyStocktakingSession[]>('feed_factory_monthly_stocktaking_sessions', []);
  const serverPartners = await partnersApi.list();
  const serverOrders = await ordersApi.list();
  const partnerIdMap = new Map<string, string>();
  let migratedPartners = 0;

  for (const legacy of legacyPartners) {
    const existing = serverPartners.find((partner) => partner.name === legacy.name);
    const partner = existing || await partnersApi.create({
      name: legacy.name,
      type: legacy.type,
      phone: legacy.phone,
      address: legacy.address,
      notes: legacy.notes,
    }, `${MIGRATION_IDEMPOTENCY_PREFIX}-partner-${legacy.id}`);
    partnerIdMap.set(legacy.id, partner.id);
    if (!existing) migratedPartners += 1;
  }

  let migratedOrders = 0;
  for (const legacy of legacyOrders) {
    const existing = serverOrders.find((order) => order.orderNumber === legacy.orderNumber);
    if (existing) {
      partnerIdMap.set(legacy.id, existing.id);
      continue;
    }
    const partnerId = partnerIdMap.get(legacy.partnerId);
    if (!partnerId) continue;
    await ordersApi.create({
      orderNumber: legacy.orderNumber,
      type: legacy.type,
      partnerId,
      date: legacy.date,
      status: legacy.status,
      warehouseId: legacy.warehouseId,
      items: legacy.items,
      totalAmount: legacy.totalAmount,
      notes: legacy.notes,
    }, `${MIGRATION_IDEMPOTENCY_PREFIX}-order-${legacy.id}`);
    migratedOrders += 1;
  }

  let migratedStocktaking = 0;
  for (const legacy of legacyStocktaking) {
    const session = await stocktakingApi.get(legacy.monthKey) || await stocktakingApi.create(legacy.monthKey, 'default', `${MIGRATION_IDEMPOTENCY_PREFIX}-stocktaking-${legacy.monthKey}`);
    for (const [itemId, record] of Object.entries(legacy.itemRecords || {})) {
      if (record.actualCount == null) continue;
      await stocktakingApi.upsertEntry(session.id, {
        itemId,
        actualCount: Number(record.actualCount),
        notes: record.notes,
      }, `${MIGRATION_IDEMPOTENCY_PREFIX}-stocktaking-entry-${legacy.monthKey}-${itemId}`);
    }
    if (legacy.closed) {
      await stocktakingApi.close(session.id, {
        archivedPdfName: legacy.archivedPdfName,
        archivedPdfMime: legacy.archivedPdfMime,
        archivedPdfData: legacy.archivedPdfData,
      }, `${MIGRATION_IDEMPOTENCY_PREFIX}-stocktaking-close-${legacy.monthKey}`);
    }
    migratedStocktaking += 1;
  }

  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  localStorage.setItem(MIGRATION_MARKER, 'done');
  return { partners: migratedPartners, orders: migratedOrders, stocktaking: migratedStocktaking };
}
