import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TransactionService } from '../transaction/transaction.service';
import { executeIdempotently } from '../common/idempotency';
import { CreateStocktakingSessionDto, CloseStocktakingDto, UpsertStocktakingEntryDto } from './dto/stocktaking.dto';

@Injectable()
export class StocktakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
    private readonly transactionService: TransactionService,
  ) {}

  private async resolveItemId(identifier: string, client: PrismaService | any = this.prisma) {
    const normalized = String(identifier || '').trim();
    const numeric = Number(normalized);
    const item = await client.item.findFirst({
      where: { OR: [{ publicId: normalized }, ...(Number.isInteger(numeric) ? [{ id: numeric }] : [])] },
      select: { id: true, publicId: true, name: true, unit: true },
    });
    if (!item) throw new NotFoundException(`Item not found: ${identifier}`);
    return item;
  }

  private mapSession(row: any) {
    return {
      id: row.id,
      monthKey: row.monthKey,
      warehouseId: row.warehouseId,
      status: row.status,
      closed: row.status === 'closed',
      closedAt: row.closedAt?.toISOString() || undefined,
      closedById: row.closedById || undefined,
      archivedPdfName: row.archivedPdfName || undefined,
      archivedPdfMime: row.archivedPdfMime || undefined,
      entries: (row.entries || []).map((entry: any) => ({
        id: entry.id,
        itemId: entry.item?.publicId || String(entry.itemId),
        itemName: entry.item?.name || '',
        actualCount: entry.actualCount == null ? undefined : Number(entry.actualCount),
        notes: entry.notes || undefined,
        counts: (entry.counts || []).map((count: any) => ({
          userId: count.countedById || undefined,
          value: Number(count.value),
          at: count.countedAt.toISOString(),
        })),
      })),
    };
  }

  private include() {
    return {
      entries: {
        include: {
          // `sortOrder` is selected so entries follow the saved catalog order.
          // Ordered by item name, this list ignored any order the operator had
          // arranged — by hand, or by the order of the spreadsheet they imported.
          item: { select: { publicId: true, name: true, unit: true, sortOrder: true } },
          counts: { orderBy: { countedAt: 'desc' as const } },
        },
        // Two keys, as an array rather than as one object.
        //
        // `{ item: { sortOrder, id } }` — the shape every earlier version of Prisma
        // accepted, and what `tsc` still accepts, because the generated type is an
        // object with both fields optional. Prisma 7's runtime validator rejects it:
        // "Argument `item` of type ItemOrderByWithRelationInput needs at most one
        // argument, but you provided sortOrder and id". So every stocktaking read
        // answered 500, and a type-check could not see it.
        //
        // The array is Prisma's documented multi-key form and applies the keys in
        // order, so the behaviour is identical to what the object was meant to say:
        // the operator's saved catalog order first, `id` only to break a tie.
        orderBy: [{ item: { sortOrder: 'asc' as const } }, { item: { id: 'asc' as const } }],
      },
    };
  }

  async get(monthKey: string, warehouseId = 'default') {
    const row = await this.prisma.stocktakingSession.findUnique({
      where: { monthKey_warehouseId: { monthKey, warehouseId } },
      include: this.include(),
    });
    return row ? this.mapSession(row) : null;
  }

  async create(dto: CreateStocktakingSessionDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const warehouseId = dto.warehouseId || 'default';
    const execution = await executeIdempotently(this.prisma, actorId, 'stocktaking.create', idempotencyKey, { ...dto, warehouseId }, async (tx) => {
      const row = await tx.stocktakingSession.upsert({
        where: { monthKey_warehouseId: { monthKey: dto.monthKey, warehouseId } },
        update: {},
        create: { monthKey: dto.monthKey, warehouseId, createdById: actorId },
        include: this.include(),
      });
      return this.mapSession(row);
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['stocktaking', 'operations'], 'stocktaking.created', { meta: { id: execution.value.id } });
      await this.auditService.logItemAction(actorId, 'CREATE', 'StocktakingSession', execution.value.id, { monthKey: dto.monthKey }, actorUsername);
    }
    return execution.value;
  }

  async upsertEntry(sessionId: string, dto: UpsertStocktakingEntryDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    const execution = await executeIdempotently(this.prisma, actorId, 'stocktaking.entry.upsert', idempotencyKey, { sessionId, dto }, async (tx) => {
      const session = await tx.stocktakingSession.findUnique({ where: { id: sessionId }, select: { id: true, status: true, warehouseId: true } });
      if (!session) throw new NotFoundException(`Stocktaking session not found: ${sessionId}`);
      if (scope !== 'all' && session.warehouseId !== scope) throw new ForbiddenException('Stocktaking session is outside the permitted warehouse scope');
      if (session.status !== 'open') throw new ConflictException('Closed stocktaking sessions cannot be edited');
      const item = await this.resolveItemId(dto.itemId, tx);
      const entry = await tx.stocktakingEntry.upsert({
        where: { sessionId_itemId: { sessionId, itemId: item.id } },
        update: { actualCount: dto.actualCount, notes: dto.notes?.trim() || null },
        create: { sessionId, itemId: item.id, actualCount: dto.actualCount, notes: dto.notes?.trim() || null },
      });
      await tx.stocktakingCount.create({ data: { entryId: entry.id, value: dto.actualCount, countedById: actorId } });
      const row = await tx.stocktakingSession.findUnique({ where: { id: sessionId }, include: this.include() });
      return this.mapSession(row);
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['stocktaking', 'operations'], 'stocktaking.entry.updated', { meta: { sessionId, itemId: dto.itemId } });
      await this.auditService.logItemAction(actorId, 'UPDATE', 'StocktakingEntry', sessionId, { itemId: dto.itemId }, actorUsername);
    }
    return execution.value;
  }

  async resolveEntry(sessionId: string, entryId: string, dto: UpsertStocktakingEntryDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    const execution = await executeIdempotently(this.prisma, actorId, 'stocktaking.entry.resolve', idempotencyKey, { sessionId, entryId, dto }, async (tx) => {
      const session = await tx.stocktakingSession.findUnique({ where: { id: sessionId }, select: { id: true, status: true, warehouseId: true } });
      if (!session) throw new NotFoundException(`Stocktaking session not found: ${sessionId}`);
      if (scope !== 'all' && session.warehouseId !== scope) throw new ForbiddenException('Stocktaking session is outside the permitted warehouse scope');
      if (session.status !== 'open') throw new ConflictException('Closed stocktaking sessions cannot be edited');
      const entry = await tx.stocktakingEntry.findFirst({ where: { id: entryId, sessionId }, select: { id: true, itemId: true } });
      if (!entry) throw new NotFoundException(`Stocktaking entry not found: ${entryId}`);
      await tx.stocktakingCount.deleteMany({ where: { entryId } });
      await tx.stocktakingCount.create({ data: { entryId, value: dto.actualCount, countedById: actorId } });
      await tx.stocktakingEntry.update({ where: { id: entryId }, data: { actualCount: dto.actualCount, notes: dto.notes?.trim() || null } });
      const row = await tx.stocktakingSession.findUnique({ where: { id: sessionId }, include: this.include() });
      return this.mapSession(row);
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['stocktaking', 'operations'], 'stocktaking.entry.resolved', { meta: { sessionId, entryId, itemId: dto.itemId } });
      await this.auditService.logItemAction(actorId, 'RESOLVE', 'StocktakingEntry', entryId, { sessionId, itemId: dto.itemId }, actorUsername);
    }
    return execution.value;
  }

  async reopen(sessionId: string, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    const execution = await executeIdempotently(this.prisma, actorId, 'stocktaking.reopen', idempotencyKey, { sessionId }, async (tx) => {
      const session = await tx.stocktakingSession.findUnique({ where: { id: sessionId }, select: { id: true, status: true, warehouseId: true } });
      if (!session) throw new NotFoundException(`Stocktaking session not found: ${sessionId}`);
      if (scope !== 'all' && session.warehouseId !== scope) throw new ForbiddenException('Stocktaking session is outside the permitted warehouse scope');
      if (session.status !== 'closed') throw new ConflictException('Only closed stocktaking sessions can be reopened');
      const row = await tx.stocktakingSession.update({
        where: { id: sessionId },
        data: { status: 'open', closedAt: null, closedById: null },
        include: this.include(),
      });
      return this.mapSession(row);
    },
      // FC-AUD-001 — reopening reverses a closed period, so it is audited
      // inside the same transaction.
      async (tx) => {
        await this.auditService.logItemAction(
          actorId,
          'STOCKTAKING_REOPEN',
          'StocktakingSession',
          sessionId,
          { requestId: idempotencyKey || null },
          actorUsername,
          'SUCCESS',
          { client: tx },
        );
      },
    );
    if (!execution.replayed) {
      this.realtimeService.emitSync(['stocktaking', 'operations'], 'stocktaking.reopened', { meta: { id: sessionId } });
    }
    return execution.value;
  }

  async close(sessionId: string, dto: CloseStocktakingDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    const execution = await executeIdempotently(this.prisma, actorId, 'stocktaking.close', idempotencyKey, { sessionId, dto }, async (tx) => {
      const session = await tx.stocktakingSession.findUnique({ where: { id: sessionId }, include: { entries: { include: { counts: true } } } });
      if (!session) throw new NotFoundException(`Stocktaking session not found: ${sessionId}`);
      if (scope !== 'all' && session.warehouseId !== scope) throw new ForbiddenException('Stocktaking session is outside the permitted warehouse scope');
      if (session.status !== 'open') throw new ConflictException('Stocktaking session is already closed');
      const hasConflicts = session.entries.some((entry) => new Set(entry.counts.map((count) => Number(count.value))).size > 1);
      if (hasConflicts) throw new ConflictException('Conflicting stocktaking counts must be resolved before closing');
      for (const entry of session.entries) {
        if (entry.actualCount == null) continue;
        const item = await tx.item.findUnique({ where: { id: entry.itemId }, select: { currentStock: true } });
        if (!item) continue;
        await this.transactionService.applyStocktakingVariance(tx, {
          itemId: entry.itemId,
          expected: Number(item.currentStock),
          actual: Number(entry.actualCount),
          actorId,
          date: new Date(`${session.monthKey}-01T00:00:00.000Z`),
          sourceReference: `stocktaking:${sessionId}:${entry.id}`,
          reason: 'Stocktaking reconciliation',
        });
      }
      const row = await tx.stocktakingSession.update({
        where: { id: sessionId },
        data: {
          status: 'closed',
          closedAt: new Date(),
          closedById: actorId,
          archivedPdfName: dto.archivedPdfName?.trim() || null,
          archivedPdfMime: dto.archivedPdfMime?.trim() || null,
          archivedPdfData: dto.archivedPdfData || null,
        },
        include: this.include(),
      });
      return this.mapSession(row);
    },
      // FC-AUD-001 — closing posts real stock variances, so the audit record
      // must commit together with those corrections or not at all.
      async (tx, session) => {
        await this.auditService.logItemAction(
          actorId,
          'STOCKTAKING_CLOSE',
          'StocktakingSession',
          sessionId,
          {
            monthKey: session.monthKey,
            entryCount: Array.isArray(session.entries) ? session.entries.length : undefined,
            requestId: idempotencyKey || null,
          },
          actorUsername,
          'SUCCESS',
          { client: tx },
        );
      },
    );
    if (!execution.replayed) {
      this.realtimeService.emitSync(['stocktaking', 'operations'], 'stocktaking.closed', { meta: { id: sessionId } });
    }
    return execution.value;
  }
}
