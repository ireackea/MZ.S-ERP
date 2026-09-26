import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { DECIMAL_SCALE, parseDecimal, serializeDecimal } from '../common/decimal';
import { DEFICIT_STATUSES, type DeficitStatus } from '../common/stock-deficit';

/**
 * DEF-001 — the deficit queue.
 *
 * A deficit is not an error to be deleted; it is a dated, attributable fact that
 * somebody has to resolve. This service makes the queue visible and gives it
 * exactly three honest exits:
 *
 *  - SETTLED_BY_RECEIPT  automatic: an incoming movement paid it down
 *  - SETTLED_BY_CORRECTION  the original movement was wrong and has been fixed
 *  - WRITTEN_OFF          the shortfall is accepted as a loss, with a reason
 *
 * Writing a deficit off is the only way to close one without a movement, and it
 * requires an explicit reason plus the resolve permission, so "make the alert go
 * away" is always a deliberate, attributable act.
 */
@Injectable()
export class StockDeficitService {
  private readonly logger = new Logger(StockDeficitService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toApi(row: any) {
    return {
      id: row.id,
      publicId: row.publicId,
      itemId: row.item.publicId,
      itemName: row.item.name,
      itemCode: row.item.code,
      unit: row.item.unit,
      warehouseId: row.warehouseId,
      quantity: serializeDecimal(row.quantity),
      status: row.status,
      sourceTransactionId: row.sourceTransactionId,
      settledByTransactionId: row.settledByTransactionId,
      reason: row.reason,
      resolution: row.resolution,
      createdById: row.createdById,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      resolvedById: row.resolvedById,
    };
  }

  async list(input: { status?: string; itemId?: string; limit: number; offset: number }) {
    const where: Prisma.StockDeficitWhereInput = {};
    if (input.status && input.status !== 'ALL') {
      if (!DEFICIT_STATUSES.includes(input.status as DeficitStatus)) {
        throw new BadRequestException(
          `Unknown deficit status. Expected one of: ${DEFICIT_STATUSES.join(', ')}, ALL`,
        );
      }
      where.status = input.status;
    }
    if (input.itemId) where.item = { publicId: input.itemId };

    const [rows, total, openAgg] = await Promise.all([
      this.prisma.stockDeficit.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: input.limit,
        skip: input.offset,
        include: { item: { select: { publicId: true, name: true, code: true, unit: true } } },
      }),
      this.prisma.stockDeficit.count({ where }),
      this.prisma.stockDeficit.aggregate({
        // The open totals must honour the same item filter as the rows.
        // Aggregating every open deficit regardless of the requested item made
        // a per-item page report another item's debt.
        where: { ...where, status: 'OPEN' },
        _sum: { quantity: true },
        _count: true,
      }),
    ]);

    return {
      data: rows.map((row) => this.toApi(row)),
      total,
      limit: input.limit,
      offset: input.offset,
      openCount: openAgg._count,
      openQuantity: serializeDecimal(openAgg._sum.quantity ?? 0) ?? '0.000',
    };
  }

  /** The deficit attached to one item, for the item page and for realtime. */
  async openForItem(itemPublicId: string) {
    const rows = await this.prisma.stockDeficit.findMany({
      where: { item: { publicId: itemPublicId }, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
    });
    const total = rows.reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
    return {
      openCount: rows.length,
      openQuantity: serializeDecimal(total) ?? '0.000',
      data: rows.map((row) => this.toApi({ ...row, item: { publicId: itemPublicId, name: '', code: null, unit: null } })),
    };
  }

  /**
   * Accept the shortfall as a loss. The deficit closes but the ledger is left
   * alone: the movement history stays truthful, and the write-off is the record
   * of the decision.
   */
  async writeOff(publicId: string, input: { reason: string; actorId: string }) {
    const reason = String(input.reason || '').trim();
    if (reason.length < 10) {
      throw new BadRequestException('A write-off reason of at least 10 characters is required');
    }

    const deficit = await this.prisma.stockDeficit.findUnique({ where: { publicId } });
    if (!deficit) throw new NotFoundException(`Stock deficit not found: ${publicId}`);
    if (deficit.status !== 'OPEN') {
      throw new BadRequestException(`Deficit is already ${deficit.status} and cannot be written off`);
    }

    // DEF-001: closing a deficit has to move the ledger, not just relabel a row.
    // The invariant is currentStock = ledgerNet + openDeficit, so dropping the
    // open deficit without offsetting the ledger would leave
    // currentStock != ledgerNet and turn reconciliation permanently red.
    //
    // The shortfall is recorded as a receiving correction: the goods that never
    // physically existed are returned to the ledger, and the balance stays at
    // zero because nothing arrived in the warehouse. A stock adjustment is used
    // rather than a manual column edit so the correction is itself auditable and
    // reversible.
    const quantity = deficit.quantity;
    const correctionId = `deficit-writeoff-${randomUUID()}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          publicId: correctionId,
          date: new Date(),
          itemId: deficit.itemId,
          warehouseId: deficit.warehouseId,
          type: 'STOCK_ADJUSTMENT',
          quantity,
          adjustmentDirection: 'INCREASE',
          supplierOrReceiver: 'Deficit write-off',
          notes: reason,
          adjustmentReason: reason,
          adjustmentSourceReference: `stock-deficit:${publicId}`,
          createdByUserId: input.actorId,
        },
      });
      // The correction raises the ledger only. The balance column must not move:
      // the goods were never in the warehouse, so clearing the phantom demand
      // must not invent stock. That is what keeps
      // currentStock === ledgerNet + openDeficit true afterwards.
      const closed = await tx.stockDeficit.update({
        where: { publicId },
        data: {
          status: 'WRITTEN_OFF',
          resolution: reason,
          settledByTransactionId: correctionId,
          resolvedAt: new Date(),
          resolvedById: input.actorId,
        },
      });
      return { closed, created };
    });

    this.logger.log(
      `DEF-001 deficit ${publicId} (${serializeDecimal(quantity)}) written off by ${input.actorId} `
      + `via correction ${correctionId}`,
    );
    return this.toApi({ ...updated.closed, item: await this.itemStub(deficit.itemId) });
  }

  private async itemStub(itemId: number) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { publicId: true, name: true, code: true, unit: true },
    });
    return item ?? { publicId: '', name: '', code: null, unit: null };
  }

  /** Reopening is only meaningful for a write-off; a settled debt is settled. */
  async reopen(publicId: string, actorId: string) {
    const deficit = await this.prisma.stockDeficit.findUnique({ where: { publicId } });
    if (!deficit) throw new NotFoundException(`Stock deficit not found: ${publicId}`);
    if (deficit.status !== 'WRITTEN_OFF') {
      throw new BadRequestException('Only a written-off deficit can be reopened');
    }
    const updated = await this.prisma.stockDeficit.update({
      where: { publicId },
      data: {
        status: 'OPEN',
        resolution: null,
        resolvedAt: null,
        resolvedById: null,
        createdById: actorId,
      },
    });
    return this.toApi({ ...updated, item: await this.itemStub(deficit.itemId) });
  }
}
