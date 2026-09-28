// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Transaction as DbTransaction } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
// AuditService: مُضافة لتسجيل جميع عمليات المعاملات المالية (إنشاء/تحديث/حذف)
// لضمان المساءلة الكاملة (Full Accountability) في بيئات الإنتاج
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { DeleteTransactionsDto } from './dto/delete-transactions.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { StockAdjustmentDto, StockAdjustmentDirection } from './dto/stock-adjustment.dto';
import { TimeService } from '../common/time/time.service';
import { warehouseScopeCondition } from '../common/scope';
import { movementDelta } from '../common/operation-type';
import {
  DECIMAL_SCALE,
  assertDecimalFieldsExact,
  parseDecimal,
  parseOptionalDecimal,
  serializeDecimal,
} from '../common/decimal';
import {
  DEFAULT_DEFICIT_POLICY,
  DEFICIT_POLICIES,
  StockOverIssueError,
  planMovement,
  type DeficitPolicy,
} from '../common/stock-deficit';

/** The only deficit status that still counts against the balance. */
const DEFICIT_OPEN = 'OPEN';

/**
 * FC-DEF-001 — recognise a serialisable-isolation write conflict.
 *
 * Prisma reports P2034 directly, but the Postgres driver adapter wraps driver
 * errors in a DriverAdapterError that keeps the original as a nested cause, so a
 * check of `error.code` alone misses every conflict coming from this deployment.
 * Two concurrent movements against the same item hit exactly this path.
 */
const isWriteConflict = (error: unknown, depth = 0): boolean => {
  if (!error || typeof error !== 'object' || depth > 4) return false;
  const candidate = error as { code?: unknown; cause?: unknown; originalCode?: unknown; message?: unknown };
  if (candidate.code === 'P2034' || candidate.originalCode === 'P2034') return true;
  if (typeof candidate.message === 'string'
    && /write conflict|serialization failure|could not serialize/i.test(candidate.message)) {
    return true;
  }
  return isWriteConflict(candidate.cause, depth + 1);
};
import {
  expandOperationTypeAliases,
  resolveCanonicalOperationType,
} from '../common/operation-type-aliases';

/** The Decimal columns on `Transaction` that must cross the boundary exactly. */
const TRANSACTION_DECIMAL_FIELDS = [
  'quantity', 'supplierNet', 'difference', 'packageCount',
  'salaryOfWorker', 'delayPenalty', 'calculatedFine',
] as const;

type TxWithItem = DbTransaction & {
  item: {
    id: number;
    publicId: string | null;
    code: string | null;
    name: string;
    unit: string | null;
    category: string;
  };
};

@Injectable()
export class TransactionService {
  // Logger مُخصص للفئة بدلاً من console.error العام، يتيح تتبع الأخطاء بدقة
  private readonly logger = new Logger(TransactionService.name);

  /** FC-DEF-001 — one warning for ALLOW, not one per movement. */
  private warnedAboutAllowPolicy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    // AuditService مُحقونة (injected) عبر NestJS DI — لا تُنشأ يدوياً
    private readonly auditService: AuditService,
    private readonly timeService: TimeService,
  ) {}

  private stableSerialize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableSerialize(entry)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableSerialize(record[key])}`).join(',')}}`;
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const key = String(value || '').trim();
    if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new BadRequestException('Idempotency-Key must be 8-200 safe characters');
    }
    return key;
  }

  /**
   * FC-AUD-001 — the identity recorded in the audit row.
   *
   * Prefers the client-visible publicId so the audit trail can be correlated
   * with an API response or a UI reference; falls back to the row id.
   */
  private auditEntityId(rows: Array<{ publicId?: string | null; id?: string | number }>): string {
    if (rows.length === 1) {
      return String(rows[0]?.publicId || rows[0]?.id || 'unknown');
    }
    const publicIds = rows.map((row) => row.publicId).filter(Boolean);
    return publicIds.length ? `bulk-${publicIds.length}` : `bulk-${rows.length}`;
  }

  private async executeIdempotently<T>(
    actorId: string,
    operation: string,
    idempotencyKey: string | undefined,
    payload: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    /**
     * FC-AUD-001 — audit writes registered here run inside the SAME transaction
     * as the business change, so a committed mutation always has its audit row
     * and a rolled-back one leaves no trace.
     */
    audit?: (tx: Prisma.TransactionClient, result: T) => Promise<void>,
  ): Promise<{ value: T; replayed: boolean }> {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const requestHash = createHash('sha256').update(this.stableSerialize(payload)).digest('hex');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const value = await this.prisma.$transaction(async (tx) => {
          const record = await tx.idempotencyRecord.create({
            data: {
              actorId,
              operation,
              key,
              requestHash,
              response: {} as Prisma.InputJsonValue,
            },
          });
          const result = await work(tx);
          if (audit) {
            await audit(tx, result);
          }
          await tx.idempotencyRecord.update({
            where: { id: record.id },
            data: { response: result as Prisma.InputJsonValue },
          });
          return result;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });

        return { value, replayed: false };
      } catch (error: any) {
        if (error?.code === 'P2002') {
          const existing = await this.prisma.idempotencyRecord.findUnique({
            where: { actorId_operation_key: { actorId, operation, key } },
          });
          if (!existing) throw error;
          if (existing.requestHash !== requestHash) {
            throw new ConflictException('Idempotency key was already used with a different payload');
          }
          return { value: existing.response as unknown as T, replayed: true };
        }
        if (isWriteConflict(error) && attempt < 2) continue;
        // A write conflict that survives the retries is a concurrency problem,
        // not a server fault. Surfacing it as a 500 told the client the system
        // was broken when the only thing wrong was that two movements touched
        // the same item at the same moment and one of them has to be retried.
        if (isWriteConflict(error)) {
          throw new ConflictException(
            'Transaction could not acquire a consistent database state. Retry the request.',
          );
        }
        throw error;
      }
    }

    throw new ConflictException('Transaction could not acquire a consistent database state');
  }

  private assertKnownOperationType(type: string): void {
    const canonical = this.canonicalOperationType(type);
    if (!['وارد', 'صادر', 'انتاج', 'هالك', 'مرتجع', 'STOCK_ADJUSTMENT'].includes(canonical)) {
      throw new BadRequestException(`Unsupported operation type: ${type}`);
    }
  }

  private assertStockAdjustmentFields(input: {
    adjustmentDirection?: StockAdjustmentDirection | string | null;
    adjustmentReason?: string | null;
    adjustmentSourceReference?: string | null;
  }): void {
    if (!['INCREASE', 'DECREASE'].includes(String(input.adjustmentDirection || '').toUpperCase())) {
      throw new BadRequestException('Stock adjustment direction must be INCREASE or DECREASE');
    }
    if (String(input.adjustmentReason || '').trim().length < 3) {
      throw new BadRequestException('Stock adjustment reason is required');
    }
    if (!String(input.adjustmentSourceReference || '').trim()) {
      throw new BadRequestException('Stock adjustment sourceReference is required');
    }
  }

  private includeItem() {
    return {
      item: {
        select: {
          id: true,
          publicId: true,
          code: true,
          name: true,
          unit: true,
          category: true,
        },
      },
    } as const;
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined): number | undefined {
    if (value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /**
   * FC-DATA-001 — a null-preserving decimal parse for optional money fields.
   * `undefined`/`null` must stay absent so Prisma leaves the column alone.
   */
  private optionalDecimal(value: unknown, field: string): Prisma.Decimal | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return parseDecimal(value, field);
  }

  private toDate(value: string | Date): Date {
    try {
      return this.timeService.parseDate(value);
    } catch {
      throw new BadRequestException('Invalid transaction date');
    }
  }

  private canonicalOperationType(type: string): string {
    // FC-API-002 — the alias table is owned by common/operation-type-aliases so
    // the reports cannot drift from the stock model.
    return resolveCanonicalOperationType(type);
  }

  private expandOperationTypeAliases(type: string): string[] {
    // FC-API-002 — expanded from the shared alias table.
    return expandOperationTypeAliases(type);
  }

  /**
   * DEF-001 — the over-issue policy. Configurable so an operator can tighten it
   * to STRICT once the deficit queue is being worked, without a code change.
   * An unrecognised value falls back to the safe default rather than to ALLOW.
   */
  private get deficitPolicy(): DeficitPolicy {
    const configured = String(process.env.STOCK_DEFICIT_POLICY || '').trim().toUpperCase();
    if (DEFICIT_POLICIES.includes(configured as DeficitPolicy)) {
      if (configured === 'ALLOW' && !this.warnedAboutAllowPolicy) {
        this.warnedAboutAllowPolicy = true;
        this.logger.warn(
          'DEF-001 STOCK_DEFICIT_POLICY=ALLOW is active. Negative balances will be written as-is, '
          + 'no deficit is recorded, and the stock reconciliation will report every shortfall as a '
          + 'permanent mismatch. This is a migration setting, not a normal one.',
        );
      }
      return configured as DeficitPolicy;
    }
    if (configured) {
      this.logger.warn(`Unknown STOCK_DEFICIT_POLICY "${configured}"; using ${DEFAULT_DEFICIT_POLICY}`);
    }
    return DEFAULT_DEFICIT_POLICY;
  }

  private toDelta(type: string, quantity: number, adjustmentDirection?: StockAdjustmentDirection | string | null): number {    // FC-API-002 — the stock sign is derived from the canonical classifier, so
    // the ledger and every report aggregate use the same rule.
    if (!Number.isFinite(quantity)) return 0;
    return movementDelta({ type, quantity, adjustmentDirection });
  }

  /**
   * FC-DATA-001 — the same classifier, but in Decimal. Used by the update path,
   * where the stock correction is a difference of two quantities and a float
   * would leave a residue on the ledger.
   */
  private toDecimalDelta(
    type: string,
    quantity: Prisma.Decimal,
    adjustmentDirection?: StockAdjustmentDirection | string | null,
  ): Prisma.Decimal {
    const signed = movementDelta({ type, quantity: 1, adjustmentDirection }) < 0
      ? quantity.negated()
      : quantity;
    return signed.toDecimalPlaces(DECIMAL_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  }

  private transactionWhereByIdentifier(identifier: string): Prisma.TransactionWhereInput {
    const normalized = String(identifier || '').trim();
    const asNumber = Number(normalized);

    return {
      OR: [
        { publicId: normalized },
        ...(Number.isInteger(asNumber) ? [{ id: asNumber }] : []),
      ],
    };
  }

  private async resolveItemId(
    itemIdentifier: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const normalized = String(itemIdentifier || '').trim();
    if (!normalized) {
      throw new BadRequestException('itemId is required');
    }

    const asNumber = Number(normalized);
    const item = await client.item.findFirst({
      where: {
        OR: [
          { publicId: normalized },
          ...(Number.isInteger(asNumber) ? [{ id: asNumber }] : []),
        ],
      },
      select: { id: true },
    });

    if (!item) {
      throw new NotFoundException(`Item not found for identifier: ${normalized}`);
    }

    return item.id;
  }

  private async resolveUnloadingRuleId(
    unloadingRuleIdentifier: string | null | undefined,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | undefined> {
    const normalized = String(unloadingRuleIdentifier || '').trim();
    if (!normalized) {
      return undefined;
    }

    // Gate 4.2 - deactivation is enforced here, not only in the list a screen
    // happens to be showing.
    //
    // `UnloadingRuleService.findAll` filters `isActive: true` unless the caller
    // holds settings permissions, so the rule disappears from every operator's
    // dropdown. But the use site looked it up by id alone, so POST /transactions,
    // the bulk path and PUT /transactions/:id would accept a deactivated rule id
    // and keep calculating penalties from a rule the business had switched off —
    // while `deleteMany`'s linkage guard then made that rule permanently
    // undeletable. Hiding it in the UI is not enforcing it.
    const unloadingRule = await client.unloadingRule.findUnique({
      where: { id: normalized },
      select: { id: true, isActive: true, ruleName: true },
    });

    if (!unloadingRule) {
      throw new NotFoundException(`Unloading rule not found: ${normalized}`);
    }
    if (!unloadingRule.isActive) {
      throw new BadRequestException(
        `Unloading rule "${unloadingRule.ruleName}" is deactivated and cannot be applied to a movement. `
        + 'Choose an active rule, or re-activate it in settings first.',
      );
    }

    return unloadingRule.id;
  }

  private async resolveItemIdMap(
    itemIdentifiers: Array<string | null | undefined>,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, number>> {
    const normalizedIdentifiers = Array.from(
      new Set(
        itemIdentifiers
          .map((identifier) => String(identifier || '').trim())
          .filter(Boolean),
      ),
    );

    if (normalizedIdentifiers.length === 0) {
      return new Map();
    }

    const numericIds = normalizedIdentifiers
      .map((identifier) => Number(identifier))
      .filter((identifier) => Number.isInteger(identifier));

    const items = await client.item.findMany({
      where: {
        OR: [
          { publicId: { in: normalizedIdentifiers } },
          ...(numericIds.length > 0 ? [{ id: { in: numericIds } }] : []),
        ],
      },
      select: {
        id: true,
        publicId: true,
      },
    });

    const resolved = new Map<string, number>();
    for (const item of items) {
      resolved.set(String(item.id), item.id);
      if (item.publicId) {
        resolved.set(item.publicId, item.id);
      }
    }

    for (const identifier of normalizedIdentifiers) {
      if (!resolved.has(identifier)) {
        throw new NotFoundException(`Item not found for identifier: ${identifier}`);
      }
    }

    return resolved;
  }

  private async resolveUnloadingRuleIdMap(
    unloadingRuleIdentifiers: Array<string | null | undefined>,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, string>> {
    const normalizedIdentifiers = Array.from(
      new Set(
        unloadingRuleIdentifiers
          .map((identifier) => String(identifier || '').trim())
          .filter(Boolean),
      ),
    );

    if (normalizedIdentifiers.length === 0) {
      return new Map();
    }

    // The same rule as the single path, so the bulk path is not a way around it.
    const unloadingRules = await client.unloadingRule.findMany({
      where: {
        id: { in: normalizedIdentifiers },
      },
      select: {
        id: true,
        isActive: true,
        ruleName: true,
      },
    });

    const inactive = unloadingRules.filter((rule) => !rule.isActive);
    if (inactive.length) {
      throw new BadRequestException(
        `Cannot apply deactivated unloading rule(s): ${inactive
          .map((rule) => rule.ruleName)
          .join(', ')}. Choose active rules, or re-activate them in settings first.`,
      );
    }

    const resolved = new Map<string, string>();
    for (const unloadingRule of unloadingRules) {
      resolved.set(unloadingRule.id, unloadingRule.id);
    }

    for (const identifier of normalizedIdentifiers) {
      if (!resolved.has(identifier)) {
        throw new NotFoundException(`Unloading rule not found: ${identifier}`);
      }
    }

    return resolved;
  }

  /**
   * DEF-001 — announce deficits after the transaction has committed.
   *
   * Emitting from inside the transaction would tell every connected client
   * about a shortfall that a rollback then erases, so the announcement is
   * deliberately deferred to the caller.
   */
  private announceDeficits(
    deficits: Array<{ itemId: number; quantity: Prisma.Decimal }>,
    scope: string,
  ): void {
    if (!deficits.length) return;
    this.realtimeService.emitSync(
      ['items', 'transactions', 'operations', 'dashboard', 'stocktaking'],
      'stock.deficit-recorded',
      {
        meta: {
          count: deficits.length,
          items: deficits.map((d) => ({ itemId: d.itemId, quantity: serializeDecimal(d.quantity) })),
        },
        scope,
        conflict: true,
      },
    );
  }

  /**
   * FC-INV-001 / DEF-001 — the single place `Item.currentStock` is written.
   *
   * Every movement goes through `planMovement`, which clamps the balance at zero
   * and reports the unfulfilled remainder. The remainder is written to
   * `StockDeficit` in the same transaction as the movement, so the invariant
   * `currentStock = ledgerNet + openDeficit` cannot be broken by a partial write:
   * either the movement, the clamped balance and the deficit all commit, or none
   * of them do.
   */
  private async applyStockDeltas(
    client: Prisma.TransactionClient,
    // FC-DATA-001 — a delta may be a Decimal (stocktaking variance) or a plain
    // number, and both must reach the column without a float round trip.
    stockDeltaByItemId: Map<number, Prisma.Decimal | number>,
    context: {
      warehouseId?: string;
      actorId?: string;
      sourceTransactionId?: string;
    } = {},
  ): Promise<Array<{ itemId: number; quantity: Prisma.Decimal }>> {
    // DEF-001 — the deficits raised by this call, so the caller can announce
    // them after the transaction commits rather than from inside it.
    const created: Array<{ itemId: number; quantity: Prisma.Decimal }> = [];
    for (const [itemId, delta] of stockDeltaByItemId.entries()) {
      const decimal = delta instanceof Prisma.Decimal
        ? delta
        : new Prisma.Decimal(String(delta));
      if (!decimal.isFinite() || decimal.isZero()) {
        continue;
      }

      // Read the balance and the outstanding debt together: the plan depends on
      // both, and reading them separately would race with a concurrent movement.
      const current = await client.item.findUnique({
        where: { id: itemId },
        select: { currentStock: true },
      });
      if (!current) {
        throw new NotFoundException(`Item not found for id: ${itemId}`);
      }

      const openDeficits = await client.stockDeficit.findMany({
        where: { itemId, status: DEFICIT_OPEN },
        select: {
          id: true,
          quantity: true,
          createdAt: true,
          warehouseId: true,
          sourceTransactionId: true,
          reason: true,
          createdById: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const openDeficitTotal = openDeficits.reduce(
        (total, entry) => total.plus(entry.quantity),
        new Prisma.Decimal(0),
      );

      const plan = (() => {
        try {
          return planMovement(current.currentStock, openDeficitTotal, decimal, this.deficitPolicy);
        } catch (error) {
          if (error instanceof StockOverIssueError) {
            // STRICT policy: this is the caller's problem to fix, so it must be a
            // 400 naming the item, not an opaque 500 from the domain layer.
            throw new BadRequestException(
              `Issue exceeds the available balance: ${error.requested.toFixed(DECIMAL_SCALE)} requested, `
              + `${error.available.toFixed(DECIMAL_SCALE)} available`,
            );
          }
          throw error;
        }
      })();

      if (plan.absorbedByOpenDeficits.gt(0) && openDeficits.length > 0) {
        // Incoming stock pays down the oldest debt first (FIFO), so an alert is
        // not left open behind a newer one that already paid off. A partial
        // payment closes the amount it covered and opens a fresh record for the
        // remainder, so the queue always shows the true outstanding amount
        // instead of silently rounding a debt to zero.
        let remaining = plan.absorbedByOpenDeficits;
        for (const entry of openDeficits) {
          if (remaining.lte(0)) break;
          const applied = entry.quantity.gt(remaining) ? remaining : entry.quantity;
          const leftover = entry.quantity.minus(applied);
          remaining = remaining.minus(applied);

          await client.stockDeficit.update({
            where: { id: entry.id },
            data: {
              quantity: applied,
              status: 'SETTLED_BY_RECEIPT',
              settledByTransactionId: context.sourceTransactionId,
              resolvedAt: new Date(),
              resolvedById: context.actorId,
              resolution: 'Settled automatically by an incoming movement',
            },
          });

          if (leftover.gt(0)) {
            await client.stockDeficit.create({
              data: {
                publicId: `deficit-${randomUUID()}`,
                itemId,
                warehouseId: context.warehouseId || entry.warehouseId || 'default',
                quantity: leftover,
                status: DEFICIT_OPEN,
                sourceTransactionId: entry.sourceTransactionId,
                reason: entry.reason,
                createdById: entry.createdById,
              },
            });
          }
        }
      }

      if (plan.appliedDelta.gt(0) || plan.appliedDelta.lt(0)) {
        await client.item.update({
          where: { id: itemId },
          data: {
            // FC-DATA-001 — Decimal increment, and DEF-001 — clamped at zero by
            // planMovement, so this column can never receive a negative result
            // unless the ALLOW policy is explicitly configured.
            currentStock: { increment: plan.appliedDelta },
          },
        });
      }

      if (plan.newDeficit.gt(0)) {
        await client.stockDeficit.create({
          data: {
            publicId: `deficit-${randomUUID()}`,
            itemId,
            warehouseId: context.warehouseId || 'default',
            quantity: plan.newDeficit,
            status: DEFICIT_OPEN,
            sourceTransactionId: context.sourceTransactionId,
            reason: 'Issue exceeded the available balance at the time of the movement',
            createdById: context.actorId,
          },
        });
        this.logger.warn(
          `DEF-001 stock deficit of ${plan.newDeficit.toFixed(DECIMAL_SCALE)} recorded for item ${itemId}`,
        );
        // The alert is reported back so the caller can raise it once the
        // transaction commits. Emitting from here would announce a deficit that a
        // rollback then erases.
        created.push({ itemId, quantity: plan.newDeficit });
      }
    }

    return created;
  }

  async applyStocktakingVariance(
    client: Prisma.TransactionClient,
    input: {
      itemId: number;
      expected: number;
      actual: number;
      actorId: string;
      date: Date;
      sourceReference: string;
      reason: string;
    },
  ): Promise<string | null> {
    // FC-DATA-001 — the variance is a Decimal subtraction, not
    // `Number(actual) - Number(expected)`, which would turn 0.3 - 0.1 into
    // 0.19999999999999998 and persist that as the stock correction.
    const delta = parseDecimal(input.actual, 'stocktaking.actual')
      .minus(parseDecimal(input.expected, 'stocktaking.expected'))
      .toDecimalPlaces(DECIMAL_SCALE, Prisma.Decimal.ROUND_HALF_UP);
    if (delta.isZero()) return null;
    const magnitude = delta.abs();

    const created = await client.transaction.create({
      data: {
        publicId: `stocktaking-${randomUUID()}`,
        date: input.date,
        item: { connect: { id: input.itemId } },
        type: 'STOCK_ADJUSTMENT',
        quantity: magnitude,
        supplierOrReceiver: 'Stocktaking reconciliation',
        notes: input.reason,
        adjustmentReason: input.reason,
        adjustmentSourceReference: input.sourceReference,
        adjustmentDirection: delta.isPositive() ? 'INCREASE' : 'DECREASE',
        createdByUserId: input.actorId,
      },
    });
    const raised = await this.applyStockDeltas(client, new Map([[input.itemId, delta]]), {
      warehouseId: 'default',
      actorId: input.actorId,
      sourceTransactionId: created.publicId,
    });
    this.announceDeficits(raised, 'default');
    return created.publicId;
  }

  private resolvePreferredPublicId(dto: Partial<CreateTransactionDto>, index = 0): string {
    const direct = String(dto.publicId || dto.id || '').trim();
    if (direct) return direct;

    const signature = [
      dto.date || '',
      dto.itemId || '',
      dto.type || '',
      Number(dto.quantity ?? 0),
      dto.warehouseInvoice || '',
      dto.supplierOrReceiver || '',
      dto.timestamp ?? index,
    ].join('|');

    const digest = createHash('sha1').update(signature).digest('hex').slice(0, 24);
    return `legacy-${digest}`;
  }

  private mapToFrontend(row: TxWithItem) {
    const transactionDate = row.date instanceof Date ? row.date : this.timeService.parseDate(row.date);
    const timestamp = row.timestamp == null ? transactionDate.getTime() : Number(row.timestamp);

    return {
      id: row.publicId,
      date: this.timeService.getBusinessDateKey(transactionDate),
      itemId: row.item.publicId || String(row.itemId),
      warehouseId: row.warehouseId || undefined,
      warehouseInvoice: row.warehouseInvoice || '',
      supplierInvoice: row.supplierInvoice || undefined,
      type: this.canonicalOperationType(row.type),
      // FC-DATA-001 — serializeDecimal, not this.toNumber: a float would undo the
      // precision the write path just guaranteed, and JSON would emit exponent
      // notation for large values, breaking the ledger invariant downstream.
      quantity: serializeDecimal(row.quantity) ?? '0.000',
      supplierNet: serializeDecimal(row.supplierNet),
      difference: serializeDecimal(row.difference),
      packageCount: serializeDecimal(row.packageCount),
      weightSlip: row.weightSlip || undefined,
      salaryOfWorker: serializeDecimal(row.salaryOfWorker),
      supplierOrReceiver: row.supplierOrReceiver,
      truckNumber: row.truckNumber || undefined,
      trailerNumber: row.trailerNumber || undefined,
      driverName: row.driverName || undefined,
      entryTime: row.entryTime || undefined,
      exitTime: row.exitTime || undefined,
      unloadingRuleId: row.unloadingRuleId || undefined,
      unloadingDuration: row.unloadingDuration || undefined,
      delayDuration: row.delayDuration || undefined,
      delayPenalty: serializeDecimal(row.delayPenalty),
      calculatedFine: serializeDecimal(row.calculatedFine),
      notes: row.notes || undefined,
      attachmentData: row.attachmentData || undefined,
      attachmentName: row.attachmentName || undefined,
      attachmentType: row.attachmentType || undefined,
      googleDriveLink: row.googleDriveLink || undefined,
      adjustmentReason: row.adjustmentReason || undefined,
      adjustmentSourceReference: row.adjustmentSourceReference || undefined,
      adjustmentDirection: row.adjustmentDirection || undefined,
      createdByUserId: row.createdByUserId || undefined,
      timestamp: Number.isFinite(timestamp) ? timestamp : row.date.getTime(),
      item: {
        id: row.item.id,
        publicId: row.item.publicId || undefined,
        code: row.item.code || undefined,
        name: row.item.name,
        unit: row.item.unit || undefined,
        category: row.item.category,
      },
    };
  }

  async list(dto: ListTransactionsDto, scope = 'default') {
    const page = Math.max(1, Number(dto.page || 1));
    const limit = Math.min(10000, Math.max(1, Number(dto.limit || 500)));
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.TransactionWhereInput = {
        ...warehouseScopeCondition(scope),
      };

      if (dto.type) where.type = { in: this.expandOperationTypeAliases(dto.type) };

      if (dto.fromDate || dto.toDate) {
        where.date = {};
        if (dto.fromDate) where.date.gte = this.toDate(dto.fromDate);
        if (dto.toDate) where.date.lte = this.toDate(dto.toDate);
      }

      if (dto.search) {
        const search = dto.search.trim();
        if (search) {
          where.OR = [
            { warehouseInvoice: { contains: search } },
            { supplierInvoice: { contains: search } },
            { supplierOrReceiver: { contains: search } },
            { notes: { contains: search } },
            { truckNumber: { contains: search } },
            { driverName: { contains: search } },
          ];
        }
      }

      if (dto.itemId) {
        const itemId = await this.resolveItemId(dto.itemId);
        where.itemId = itemId;
      }

      const [rows, total] = await Promise.all([
        this.prisma.transaction.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          include: this.includeItem(),
        }),
        this.prisma.transaction.count({ where }),
      ]);

      return {
        data: rows.map((row) => this.mapToFrontend(row as TxWithItem)),
        total,
        page,
        limit,
      };
    } catch (dbError: any) {
      console.error('Transaction list DB failure:', dbError?.message || dbError);
      return {
        data: [],
        total: 0,
        page,
        limit,
        warning: 'Database error or table missing',
      } as any;
    }
  }

  async getById(id: string, scope = 'default') {
    const identifier = String(id || '').trim();
    if (!identifier) throw new BadRequestException('Transaction id is required');

    const row = await this.prisma.transaction.findFirst({
      where: { AND: [this.transactionWhereByIdentifier(identifier), warehouseScopeCondition(scope)] },
      include: this.includeItem(),
    });

    if (!row) {
      throw new NotFoundException(`Transaction not found: ${identifier}`);
    }

    return this.mapToFrontend(row as TxWithItem);
  }

  private buildCreateData(
    dto: CreateTransactionDto,
    itemId: number,
    unloadingRuleId?: string,
    forcedPublicId?: string,
    actorId?: string,
  ): Prisma.TransactionCreateInput {
    // FC-DATA-001 — quantity and the money fields are parsed through the decimal
    // boundary, so an imprecise float can never reach a Decimal column. A
    // non-integer float is refused outright rather than silently rounded.
    assertDecimalFieldsExact(dto as unknown as Record<string, unknown>, TRANSACTION_DECIMAL_FIELDS);
    const quantity = parseDecimal(dto.quantity, 'quantity');

    return {
      publicId: forcedPublicId || String(dto.publicId || dto.id || '').trim() || randomUUID(),
      date: this.toDate(dto.date),
      item: { connect: { id: itemId } },
      warehouseId: dto.warehouseId,
      warehouseInvoice: dto.warehouseInvoice,
      supplierInvoice: dto.supplierInvoice,
      type: this.canonicalOperationType(dto.type),
      quantity,
      supplierNet: this.optionalDecimal(dto.supplierNet, 'supplierNet'),
      difference: this.optionalDecimal(dto.difference, 'difference'),
      packageCount: this.optionalDecimal(dto.packageCount, 'packageCount'),
      weightSlip: dto.weightSlip,
      salaryOfWorker: this.optionalDecimal(dto.salaryOfWorker, 'salaryOfWorker'),
      supplierOrReceiver: dto.supplierOrReceiver,
      truckNumber: dto.truckNumber,
      trailerNumber: dto.trailerNumber,
      driverName: dto.driverName,
      entryTime: dto.entryTime,
      exitTime: dto.exitTime,
      unloadingRule: unloadingRuleId ? { connect: { id: unloadingRuleId } } : undefined,
      unloadingDuration: dto.unloadingDuration,
      delayDuration: dto.delayDuration,
      delayPenalty: this.optionalDecimal(dto.delayPenalty, 'delayPenalty'),
      calculatedFine: this.optionalDecimal(dto.calculatedFine, 'calculatedFine'),
      notes: dto.notes,
      attachmentData: dto.attachmentData,
      attachmentName: dto.attachmentName,
      attachmentType: dto.attachmentType,
      googleDriveLink: dto.googleDriveLink,
      adjustmentReason: dto.adjustmentReason,
      adjustmentSourceReference: dto.adjustmentSourceReference,
      adjustmentDirection: dto.adjustmentDirection,
      createdByUserId: actorId,
      timestamp: dto.timestamp == null ? undefined : BigInt(Math.floor(dto.timestamp)),
    };
  }

  // actorId/actorUsername: تُمرّران من الـ controller لإثراء سجل التدقيق بهوية منفّذ العملية
  async createOne(dto: CreateTransactionDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    const result = await this.createMany([dto], actorId, actorUsername, idempotencyKey, scope);
    if (!result.data.length) {
      throw new BadRequestException('Failed to create transaction');
    }
    return result.data[0];
  }

  // actorId/actorUsername: مُمرّران من الـ controller لنسب العملية لمنفّذها — القيمة الافتراضية 'system' تُستخدم في حالة الميغرةشن والمسارات الداخلية
  async createMany(payload: CreateTransactionDto[], actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    if (!Array.isArray(payload) || payload.length === 0) {
      return { data: [], total: 0 };
    }

    const scopedPayload = scope === 'all' ? payload : payload.map((dto) => ({ ...dto, warehouseId: scope }));
    const itemIdMap = await this.resolveItemIdMap(scopedPayload.map((dto) => dto.itemId));
    const unloadingRuleIdMap = await this.resolveUnloadingRuleIdMap(scopedPayload.map((dto) => dto.unloadingRuleId));
    // DEF-001 — collected inside the transaction, announced only after it commits.
    const deficits: Array<{ itemId: number; quantity: Prisma.Decimal }> = [];
    const execution = await this.executeIdempotently(
      actorId,
      'transactions.create-many',
      idempotencyKey,
      scopedPayload,
      async (tx) => {
        const createdRows: TxWithItem[] = [];
        const stockDeltaByItemId = new Map<number, number>();

        for (const dto of scopedPayload) {
          this.assertKnownOperationType(dto.type);
          if (this.canonicalOperationType(dto.type) === 'STOCK_ADJUSTMENT') {
            throw new BadRequestException('Use the stock adjustment endpoint for inventory corrections');
          }
          const itemIdentifier = String(dto.itemId || '').trim();
          const itemId = itemIdMap.get(itemIdentifier);
          if (!itemId) {
            throw new NotFoundException(`Item not found for identifier: ${itemIdentifier}`);
          }

          const unloadingRuleIdentifier = String(dto.unloadingRuleId || '').trim();
          const unloadingRuleId = unloadingRuleIdentifier
            ? unloadingRuleIdMap.get(unloadingRuleIdentifier)
            : undefined;

          const quantity = Number(dto.quantity ?? 0);
          const delta = this.toDelta(dto.type, quantity);

          const created = await tx.transaction.create({
            data: this.buildCreateData(dto, itemId, unloadingRuleId, undefined, actorId),
            include: this.includeItem(),
          });

          stockDeltaByItemId.set(itemId, (stockDeltaByItemId.get(itemId) || 0) + delta);
          createdRows.push(created as TxWithItem);
        }

        const raised = await this.applyStockDeltas(tx, stockDeltaByItemId, {
          warehouseId: scope,
          actorId,
        });
        deficits.push(...raised);
        return createdRows;
      },
      // FC-AUD-001 — committed in the same transaction as the stock movement.
      // The audit row keys on publicId so an investigator can find it with the
      // same id the API handed the caller, not an internal surrogate key.
      async (tx, createdRows) => {
        if (!createdRows.length) return;
        await this.auditService.logItemAction(
          actorId,
          'TRANSACTION_CREATE',
          'Transaction',
          this.auditEntityId(createdRows),
          {
            count: createdRows.length,
            scope,
            publicIds: createdRows.map((row) => row.publicId).filter(Boolean).slice(0, 50),
            requestId: idempotencyKey || null,
          },
          actorUsername,
          'SUCCESS',
          { client: tx, actorRole: actorUsername === 'system' ? 'system' : undefined },
        );
      },
    );

    const response = {
      data: execution.value.map((row) => this.mapToFrontend(row)),
      total: execution.value.length,
    };
    if (!execution.replayed && response.total > 0) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.created',
        { meta: { count: response.total }, scope },
      );
    }
    // DEF-001 — announced here, after the commit. Emitting from inside the
    // transaction would tell every connected client about a deficit that a
    // rollback then erases.
    if (!execution.replayed) this.announceDeficits(deficits, scope);
    return response;
  }

  async migrateFromLocal(payload: CreateTransactionDto[], actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    if (!Array.isArray(payload) || payload.length === 0) {
      return { total: 0, migrated: 0, skipped: 0, data: [] };
    }

    const scopedPayload = scope === 'all' ? payload : payload.map((dto) => ({ ...dto, warehouseId: scope }));
    const itemIdMap = await this.resolveItemIdMap(scopedPayload.map((dto) => dto.itemId));
    const unloadingRuleIdMap = await this.resolveUnloadingRuleIdMap(scopedPayload.map((dto) => dto.unloadingRuleId));

    const execution = await this.executeIdempotently(
      actorId,
      'transactions.migrate',
      idempotencyKey,
      scopedPayload,
      async (tx) => {
      const createdRows: TxWithItem[] = [];
      const stockDeltaByItemId = new Map<number, number>();
      let skipped = 0;

      for (let index = 0; index < scopedPayload.length; index += 1) {
        const dto = payload[index];
        this.assertKnownOperationType(dto.type);
        if (this.canonicalOperationType(dto.type) === 'STOCK_ADJUSTMENT') {
          this.assertStockAdjustmentFields(dto);
        }
        const preferredPublicId = this.resolvePreferredPublicId(dto, index);

        const exists = await tx.transaction.findUnique({
          where: { publicId: preferredPublicId },
          select: { id: true },
        });

        if (exists) {
          skipped += 1;
          continue;
        }

        const itemIdentifier = String(dto.itemId || '').trim();
        const itemId = itemIdMap.get(itemIdentifier);
        if (!itemId) {
          throw new NotFoundException(`Item not found for identifier: ${itemIdentifier}`);
        }

        const unloadingRuleIdentifier = String(dto.unloadingRuleId || '').trim();
        const unloadingRuleId = unloadingRuleIdentifier
          ? unloadingRuleIdMap.get(unloadingRuleIdentifier)
          : undefined;

        const quantity = Number(dto.quantity ?? 0);
        const delta = this.toDelta(dto.type, quantity, dto.adjustmentDirection);

        const created = await tx.transaction.create({
          data: this.buildCreateData(dto, itemId, unloadingRuleId, preferredPublicId, actorId),
          include: this.includeItem(),
        });

        stockDeltaByItemId.set(itemId, (stockDeltaByItemId.get(itemId) || 0) + delta);

        createdRows.push(created as TxWithItem);
      }

      await this.applyStockDeltas(tx, stockDeltaByItemId, {
        warehouseId: scope,
        actorId,
      });

      return {
        total: payload.length,
        migrated: createdRows.length,
        skipped,
        data: createdRows.map((row) => this.mapToFrontend(row)),
      };
    },
      // FC-AUD-001 — the audit row commits with the migrated rows themselves.
      async (tx, result) => {
        if (!result.migrated) return;
        await this.auditService.logItemAction(
          actorId,
          'TRANSACTION_MIGRATE',
          'Transaction',
          `migrated-${result.migrated}`,
          { migrated: result.migrated, skipped: result.skipped, requestId: idempotencyKey || null },
          actorUsername,
          'SUCCESS',
          { client: tx },
        );
      },
    );

    if (!execution.replayed && execution.value.migrated > 0) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.migrated',
        { meta: { migrated: execution.value.migrated, skipped: execution.value.skipped }, scope },
      );
    }
    return execution.value;
  }

  // actorId/actorUsername: تُمرّران من الـ controller لتسجيل منفّذ التحديث في سجل التدقيق
  async updateById(id: string, dto: UpdateTransactionDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    // DEF-001 — deficits raised by this call, announced once the transaction commits.
    const raisedForRealtime: Array<{ itemId: number; quantity: Prisma.Decimal }> = [];

    const identifier = String(id || '').trim();
    if (!identifier) throw new BadRequestException('Transaction id is required');

    let beforeState: { type: unknown; quantity: string | null; itemId: unknown } | null = null;

    const execution = await this.executeIdempotently(
      actorId,
      'transactions.update',
      idempotencyKey,
      { id: identifier, dto },
      async (tx) => {
      const existing = await tx.transaction.findFirst({
      where: { AND: [this.transactionWhereByIdentifier(identifier), warehouseScopeCondition(scope)] },
      });

      if (!existing) {
        throw new NotFoundException(`Transaction not found: ${identifier}`);
      }

      // FC-AUD-001 — captured so the before/after pair can be recorded by the
      // transaction-scoped audit callback below.
      beforeState = {
        type: existing.type,
        // FC-DATA-001 — the audit snapshot records the exact stored value, not
        // a float rendering of it, so the before/after pair is auditable.
        quantity: serializeDecimal(existing.quantity),
        itemId: existing.itemId,
      };

      const nextItemId = dto.itemId ? await this.resolveItemId(dto.itemId, tx) : existing.itemId;
      const nextUnloadingRuleId = dto.unloadingRuleId === undefined
        ? existing.unloadingRuleId || undefined
        : await this.resolveUnloadingRuleId(dto.unloadingRuleId, tx);

      const nextType = dto.type == null ? this.canonicalOperationType(existing.type) : this.canonicalOperationType(dto.type);
      this.assertKnownOperationType(nextType);
      const nextAdjustmentDirection = dto.adjustmentDirection === undefined
        ? nextType === 'STOCK_ADJUSTMENT' ? existing.adjustmentDirection || undefined : undefined
        : dto.adjustmentDirection;
      if (nextType === 'STOCK_ADJUSTMENT') {
        this.assertStockAdjustmentFields({
          adjustmentDirection: nextAdjustmentDirection,
          adjustmentReason: dto.adjustmentReason ?? existing.adjustmentReason,
          adjustmentSourceReference: dto.adjustmentSourceReference ?? existing.adjustmentSourceReference,
        });
      }
      // FC-DATA-001 — the reversal/apply pair is Decimal arithmetic. Computing
      // `newDelta - oldDelta` in a JS float would persist 0.6 as
      // 0.5999999999999999 when a 0.1 movement is corrected to 0.7.
      const previousQuantity = parseDecimal(existing.quantity, 'quantity');
      const nextQuantity = dto.quantity == null ? previousQuantity : parseDecimal(dto.quantity, 'quantity');
      const oldDelta = this.toDecimalDelta(existing.type, previousQuantity, existing.adjustmentDirection);
      const newDelta = this.toDecimalDelta(nextType, nextQuantity, nextAdjustmentDirection);

      const stockDeltaByItemId = new Map<number, Prisma.Decimal>();
      if (existing.itemId === nextItemId) {
        stockDeltaByItemId.set(existing.itemId, newDelta.minus(oldDelta));
      } else {
        stockDeltaByItemId.set(existing.itemId, oldDelta.negated());
        stockDeltaByItemId.set(nextItemId, newDelta);
      }
      const raised = await this.applyStockDeltas(tx, stockDeltaByItemId, {
        warehouseId: scope,
        actorId,
      });
      raisedForRealtime.push(...raised);

      const row = await tx.transaction.update({
        where: { id: existing.id },
        data: {
          date: dto.date ? this.toDate(dto.date) : undefined,
          item: dto.itemId ? { connect: { id: nextItemId } } : undefined,
          warehouseId: scope === 'all' ? dto.warehouseId : scope,
          warehouseInvoice: dto.warehouseInvoice,
          supplierInvoice: dto.supplierInvoice,
          type: dto.type === undefined ? undefined : this.canonicalOperationType(dto.type),
          // FC-DATA-001 — the money columns take the same parsed values as the
          // create path. A bare string would be coerced by the driver, which is
          // the coercion this boundary exists to prevent.
          quantity: dto.quantity === undefined ? undefined : nextQuantity,
          supplierNet: this.optionalDecimal(dto.supplierNet, 'supplierNet'),
          difference: this.optionalDecimal(dto.difference, 'difference'),
          packageCount: this.optionalDecimal(dto.packageCount, 'packageCount'),
          weightSlip: dto.weightSlip,
          salaryOfWorker: this.optionalDecimal(dto.salaryOfWorker, 'salaryOfWorker'),
          supplierOrReceiver: dto.supplierOrReceiver,
          truckNumber: dto.truckNumber,
          trailerNumber: dto.trailerNumber,
          driverName: dto.driverName,
          entryTime: dto.entryTime,
          exitTime: dto.exitTime,
          unloadingRule: dto.unloadingRuleId === undefined
            ? undefined
            : nextUnloadingRuleId
              ? { connect: { id: nextUnloadingRuleId } }
              : { disconnect: true },
          unloadingDuration: dto.unloadingDuration,
          delayDuration: dto.delayDuration,
          delayPenalty: this.optionalDecimal(dto.delayPenalty, 'delayPenalty'),
          calculatedFine: this.optionalDecimal(dto.calculatedFine, 'calculatedFine'),
          notes: dto.notes,
          attachmentData: dto.attachmentData,
          attachmentName: dto.attachmentName,
          attachmentType: dto.attachmentType,
           googleDriveLink: dto.googleDriveLink,
           adjustmentReason: nextType === 'STOCK_ADJUSTMENT' ? dto.adjustmentReason ?? existing.adjustmentReason : null,
           adjustmentSourceReference: nextType === 'STOCK_ADJUSTMENT' ? dto.adjustmentSourceReference ?? existing.adjustmentSourceReference : null,
           adjustmentDirection: nextType === 'STOCK_ADJUSTMENT' ? nextAdjustmentDirection : null,
           timestamp: dto.timestamp == null ? undefined : BigInt(Math.floor(dto.timestamp)),
        },
        include: this.includeItem(),
      });

      return this.mapToFrontend(row as TxWithItem);
    },
      // FC-AUD-001 — audit commits with the stock re-balance it describes.
      async (tx, response) => {
        await this.auditService.logItemAction(
          actorId,
          'TRANSACTION_UPDATE',
          'Transaction',
          response.id ?? 'unknown',
          {
            type: response.type,
            quantity: response.quantity,
            itemId: response.itemId,
            before: beforeState,
            after: { type: response.type, quantity: response.quantity, itemId: response.itemId },
            requestId: idempotencyKey || null,
          },
          actorUsername,
          'SUCCESS',
          { client: tx },
        );
      },
    );

    const response = execution.value;
    if (!execution.replayed) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.updated',
        { meta: { id: response.id }, scope },
      );
      // DEF-001 — a correction that turns a covered movement into an over-issue
      // must raise the alert, otherwise the shortfall is created silently.
      this.announceDeficits(raisedForRealtime, scope);
    }
    return response;
  }

  // actorId/actorUsername تُمرّران للـ deleteMany لتسجيل العملية في سجل التدقيق
  async deleteOne(id: string, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    return this.deleteMany({ ids: [id] }, actorId, actorUsername, idempotencyKey, scope);
  }

  // actorId/actorUsername: مُمرّران من الـ controller لتسجيل منفّذ الحذف
  async deleteMany(dto: DeleteTransactionsDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    // DEF-001 — deficits raised by this call, announced once the transaction commits.
    const raisedForRealtime: Array<{ itemId: number; quantity: Prisma.Decimal }> = [];

    const ids = Array.from(new Set((dto.ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) return { deleted: 0 };

    const idNumbers = ids.map((id) => Number(id)).filter((value) => Number.isInteger(value));

    const execution = await this.executeIdempotently(
      actorId,
      'transactions.delete',
      idempotencyKey,
      { ids },
      async (tx) => {
      const rows = await tx.transaction.findMany({
        where: {
          AND: [
            warehouseScopeCondition(scope),
            {
              OR: [
                { publicId: { in: ids } },
                ...(idNumbers.length ? [{ id: { in: idNumbers } }] : []),
              ],
            },
          ],
        },
      });

      const stockDeltaByItemId = new Map<number, number>();
      for (const row of rows) {
        const delta = this.toDelta(row.type, Number(row.quantity), row.adjustmentDirection);
        stockDeltaByItemId.set(
          row.itemId,
          (stockDeltaByItemId.get(row.itemId) || 0) - delta,
        );
      }
      const raised = await this.applyStockDeltas(tx, stockDeltaByItemId, {
        warehouseId: scope,
        actorId,
      });
      raisedForRealtime.push(...raised);

      const deleted = await tx.transaction.deleteMany({
        where: {
          AND: [
            warehouseScopeCondition(scope),
            {
              OR: [
                { publicId: { in: ids } },
                ...(idNumbers.length ? [{ id: { in: idNumbers } }] : []),
              ],
            },
          ],
        },
      });

      return { deleted: deleted.count, entityId: this.auditEntityId(rows) };
    },
      // FC-AUD-001 — the reversal of stock and its audit record are one commit.
      async (tx, result) => {
        if (!result.deleted) return;
        await this.auditService.logItemAction(
          actorId,
          'TRANSACTION_DELETE',
          'Transaction',
          result.entityId,
          { deleted: result.deleted, requestId: idempotencyKey || null, requestedIds: ids },          actorUsername,
          'SUCCESS',
          { client: tx },
        );
      },
    );

    const result = execution.value.deleted;
    if (!execution.replayed && result > 0) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.deleted',
        { meta: { count: result }, scope },
      );
      this.announceDeficits(raisedForRealtime, scope);
    }
    return { deleted: result };
  }

  async createStockAdjustment(
    dto: StockAdjustmentDto,
    actorId = 'system',
    actorUsername = 'system',
    idempotencyKey?: string,
    scope = 'default',
  ) {
    // DEF-001 — deficits raised by this call, announced once the transaction commits.
    const raisedForRealtime: Array<{ itemId: number; quantity: Prisma.Decimal }> = [];
    this.assertStockAdjustmentFields({
      adjustmentDirection: dto.adjustmentDirection,
      adjustmentReason: dto.reason,
      adjustmentSourceReference: dto.sourceReference,
    });
    const reason = String(dto.reason).trim();
    const sourceReference = String(dto.sourceReference).trim();
    const execution = await this.executeIdempotently(
      actorId,
      'transactions.stock-adjustment',
      idempotencyKey,
      dto,
      async (tx) => {
        const itemId = await this.resolveItemId(dto.itemId, tx);
        // FC-DATA-001 — the adjustment magnitude is parsed once, through the
        // decimal boundary. Coercing it to a number twice would round the value
        // on the way to the column and again on the way to the stock delta.
        const magnitude = parseDecimal(dto.quantity, 'quantity');
        const created = await tx.transaction.create({
          data: {
            publicId: `stock-adjustment-${randomUUID()}`,
            date: this.toDate(dto.date),
            warehouseId: scope === 'all' ? 'default' : scope,
            item: { connect: { id: itemId } },
            type: 'STOCK_ADJUSTMENT',
            quantity: magnitude,
            supplierOrReceiver: 'Stock adjustment',
            notes: reason,
            adjustmentReason: reason,
            adjustmentSourceReference: sourceReference,
            adjustmentDirection: dto.adjustmentDirection,
            createdByUserId: actorId,
          },
          include: this.includeItem(),
        });
        const delta = magnitude.mul(
          String(dto.adjustmentDirection || '').trim().toUpperCase() === 'DECREASE' ? -1 : 1,
        );
        raisedForRealtime.push(...await this.applyStockDeltas(tx, new Map([[itemId, delta]]), {
          warehouseId: scope === 'all' ? 'default' : scope,
          actorId,
          sourceTransactionId: created.publicId,
        }));
        return this.mapToFrontend(created as TxWithItem);
      },
      // FC-AUD-001 — a stock correction without its audit row is unacceptable,
      // so it commits inside the same transaction as the correction itself.
      async (tx, created) => {
        await this.auditService.logItemAction(
          actorId,
          'TRANSACTION_ADJUST',
          'Transaction',
          created.id,
          {
            itemId: created.itemId,
            quantity: dto.quantity,
            direction: dto.adjustmentDirection,
            reason,
            sourceReference,
            requestId: idempotencyKey || null,
          },
          actorUsername,
          'SUCCESS',
          { client: tx },
        );
      },
    );

    if (!execution.replayed) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.stock-adjusted',
        { meta: { id: execution.value.id, itemId: execution.value.itemId }, scope },
      );
      this.announceDeficits(raisedForRealtime, scope);
    }

    return execution.value;
  }

  async getStockReconciliation(financialYear?: number) {
    const computed = await this.getComputedBalances(financialYear);
    const warning = (computed as { warning?: string }).warning;
    if (warning) {
      return {
        financialYear: computed.financialYear,
        total: 0,
        consistent: false,
        mismatches: [],
        warning,
      };
    }

    const items = await this.prisma.item.findMany({
      select: { id: true, publicId: true, name: true, currentStock: true, sortOrder: true },
      // The saved catalog order, not the alphabet. Same contract as findAll in
      // ItemService, and the comment there explains why the tie-break is id.
      orderBy: [{ sortOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    // DEF-001 — the balance column is clamped at zero, so the ledger derived
    // from the movements is lower by exactly the outstanding deficit. Folding the
    // deficit in here is what keeps reconciliation meaningful: without it every
    // item with a recorded shortfall would be reported as a permanent mismatch.
    const deficits = await this.prisma.stockDeficit.groupBy({
      by: ['itemId'],
      where: { status: DEFICIT_OPEN },
      _sum: { quantity: true },
    });
    const deficitByItemId = new Map<number, Prisma.Decimal>(
      deficits.map((row) => [row.itemId, row._sum.quantity ?? new Prisma.Decimal(0)]),
    );
    const itemsByIdentifier = new Map<string, (typeof items)[number]>();
    items.forEach((item) => {
      itemsByIdentifier.set(String(item.id), item);
      if (item.publicId) itemsByIdentifier.set(item.publicId, item);
    });

    const mismatches = computed.data.flatMap((row) => {
      const item = itemsByIdentifier.get(String(row.itemId));
      if (!item) {
        return [{
          itemId: row.itemId,
          name: 'Unknown item',
          cachedStock: null,
          ledgerStock: Number(row.currentStock),
          difference: null,
        }];
      }
      const openDeficit = deficitByItemId.get(item.id) ?? new Prisma.Decimal(0);
      const cachedStock = Number(item.currentStock);
      // The ledger side plus the recorded debt must equal the balance column.
      const ledgerStock = new Prisma.Decimal(String(row.currentStock)).plus(openDeficit).toNumber();
      const difference = Number((cachedStock - ledgerStock).toFixed(3));
      if (Math.abs(difference) < 0.0005) return [];
      return [{
        itemId: item.publicId || String(item.id),
        name: item.name,
        cachedStock,
        ledgerStock,
        openDeficit: openDeficit.toFixed(DECIMAL_SCALE),
        difference,
      }];
    });

    const policy = this.deficitPolicy;
    return {
      financialYear: computed.financialYear,
      total: computed.total,
      consistent: mismatches.length === 0,
      mismatches,
      // FC-DEF-001 — under ALLOW a negative balance is written as-is and no debt
      // is recorded. The arithmetic still reconciles, because the negative value
      // is in the column, so this is not a data-corruption signal: it means the
      // balance is unbacked demand nobody is tracking. Saying so turns a
      // confusing negative stock into an explained one, instead of leaving an
      // operator hunting for a bug that does not exist.
      deficitPolicy: policy,
      tracksUnbackedDemand: policy !== 'ALLOW',
      note: policy === 'ALLOW'
        ? 'STOCK_DEFICIT_POLICY=ALLOW is active: a negative balance is written as-is and no deficit is recorded, so any item below zero is untracked unbacked demand. This is a migration setting, not a normal one.'
        : undefined,
    };
  }

  async getComputedBalances(financialYear?: number) {
    const year = Number(financialYear) || this.timeService.getFinancialYear();
    const { start, end } = this.timeService.getFinancialYearRange(year);
    try {
      const [items, openingRows, transactionRows] = await Promise.all([
        this.prisma.item.findMany({
        select: {
          id: true,
          publicId: true,
          name: true,
        },
        // The saved catalog order, matching the reconciliation query above.
        orderBy: [{ sortOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
      this.prisma.openingBalance.findMany({
        where: { financialYear: year },
        select: {
          itemId: true,
          quantity: true,
          updatedAt: true,
        },
      }),
      this.prisma.transaction.findMany({
        where: {
          date: {
            gte: start,
            lt: end,
          },
        },
        select: {
          itemId: true,
          type: true,
          quantity: true,
          adjustmentDirection: true,
          updatedAt: true,
        },
      }),
      ]);

      const openingMap = new Map<number, number>();
      const movementMap = new Map<number, number>();
      const lastUpdatedMap = new Map<number, Date>();

      openingRows.forEach((row) => {
        openingMap.set(row.itemId, Number(row.quantity ?? 0));
        lastUpdatedMap.set(row.itemId, row.updatedAt);
      });

      transactionRows.forEach((row) => {
        const previous = movementMap.get(row.itemId) ?? 0;
        const delta = this.toDelta(row.type, Number(row.quantity ?? 0), row.adjustmentDirection);
        movementMap.set(row.itemId, previous + delta);

        const currentLast = lastUpdatedMap.get(row.itemId);
        if (!currentLast || row.updatedAt > currentLast) {
          lastUpdatedMap.set(row.itemId, row.updatedAt);
        }
      });

      const data = items.map((item) => {
        const opening = openingMap.get(item.id) ?? 0;
        const movement = movementMap.get(item.id) ?? 0;
        const currentStock = Number((opening + movement).toFixed(3));
        const lastUpdated = lastUpdatedMap.get(item.id);

        return {
          itemId: item.publicId || String(item.id),
          currentStock,
          lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
        };
      });

      return {
        financialYear: year,
        total: data.length,
        data,
      };
    } catch (dbError: any) {
      console.error('getComputedBalances DB failure:', dbError?.message || dbError);
      return {
        financialYear: year,
        total: 0,
        data: [],
        warning: 'Database error or table missing',
      } as any;
    }
  }
}
