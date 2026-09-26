import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TimeService } from '../common/time/time.service';
import { executeIdempotently } from '../common/idempotency';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
    private readonly timeService: TimeService,
  ) {}

  private async resolveItems(
    identifiers: string[],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, { id: number; unit: string | null }>> {
    const normalized = identifiers.map((value) => String(value || '').trim()).filter(Boolean);
    if (normalized.length === 0) return new Map<string, { id: number; unit: string | null }>();
    const numeric = normalized.map(Number).filter(Number.isInteger);
    const items = await client.item.findMany({
      where: { OR: [{ publicId: { in: normalized } }, ...(numeric.length ? [{ id: { in: numeric } }] : [])] },
      select: { id: true, publicId: true, unit: true },
    });
    const result = new Map<string, { id: number; unit: string | null }>();
    items.forEach((item) => {
      result.set(String(item.id), { id: item.id, unit: item.unit });
      if (item.publicId) result.set(item.publicId, { id: item.id, unit: item.unit });
    });
    for (const identifier of normalized) {
      if (!result.has(identifier)) throw new NotFoundException(`Item not found: ${identifier}`);
    }
    return result;
  }

  private mapOrder(row: any) {
    return {
      id: row.id,
      createdByUserId: row.createdById || undefined,
      warehouseId: row.warehouseId || undefined,
      orderNumber: row.orderNumber,
      type: row.type,
      partnerId: row.partnerId,
      date: this.timeService.getBusinessDateKey(row.date),
      status: row.status,
      totalAmount: row.totalAmount == null ? undefined : Number(row.totalAmount),
      notes: row.notes || undefined,
      items: row.items.map((entry: any) => ({
        itemId: entry.item?.publicId || String(entry.itemId),
        quantity: Number(entry.quantity),
        unit: entry.unit || entry.item?.unit || '',
      })),
    };
  }

  private include() {
    return {
      partner: { select: { id: true, name: true, type: true, phone: true } },
      items: { include: { item: { select: { publicId: true, name: true, unit: true } } }, orderBy: { id: 'asc' as const } },
    };
  }

  async list(warehouseId?: string) {
    const rows = await this.prisma.order.findMany({
      where: warehouseId ? { warehouseId } : undefined,
      include: this.include(),
      orderBy: { date: 'desc' },
    });
    return rows.map((row) => this.mapOrder(row));
  }

  async create(dto: CreateOrderDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const execution = await executeIdempotently(this.prisma, actorId, 'orders.create', idempotencyKey, dto, async (tx) => {
      const partner = await tx.partner.findUnique({ where: { id: dto.partnerId }, select: { id: true } });
      if (!partner) throw new NotFoundException(`Partner not found: ${dto.partnerId}`);
      const itemMap = await this.resolveItems(dto.items.map((item) => item.itemId), tx);
      const row = await tx.order.create({
        data: {
           orderNumber: dto.orderNumber.trim(),
           type: dto.type,
           status: dto.status || 'pending',
           partnerId: dto.partnerId,
          warehouseId: dto.warehouseId || 'all',
          date: this.timeService.parseDate(dto.date),
          totalAmount: dto.totalAmount,
          notes: dto.notes?.trim() || null,
          createdById: actorId,
          items: {
            create: dto.items.map((item) => ({
              itemId: itemMap.get(item.itemId)!.id,
              quantity: item.quantity,
              unit: item.unit || itemMap.get(item.itemId)!.unit,
            })),
          },
        },
        include: this.include(),
      });
      return this.mapOrder(row);
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['orders', 'partners', 'operations'], 'orders.created', { meta: { id: execution.value.id } });
      await this.auditService.logItemAction(actorId, 'CREATE', 'Order', execution.value.id, { orderNumber: execution.value.orderNumber }, actorUsername);
    }
    return execution.value;
  }

  async update(id: string, dto: UpdateOrderDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const execution = await executeIdempotently(this.prisma, actorId, 'orders.update', idempotencyKey, { id, dto }, async (tx) => {
      const existing = await tx.order.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new NotFoundException(`Order not found: ${id}`);
      if (dto.partnerId) {
        const partner = await tx.partner.findUnique({ where: { id: dto.partnerId }, select: { id: true } });
        if (!partner) throw new NotFoundException(`Partner not found: ${dto.partnerId}`);
      }
      const itemMap = dto.items ? await this.resolveItems(dto.items.map((item) => item.itemId), tx) : null;
      const row = await tx.order.update({
        where: { id },
        data: {
          orderNumber: dto.orderNumber?.trim(),
           type: dto.type,
           status: dto.status,
           partnerId: dto.partnerId,
           warehouseId: dto.warehouseId,
          date: dto.date ? this.timeService.parseDate(dto.date) : undefined,
          totalAmount: dto.totalAmount,
          notes: dto.notes?.trim(),
          items: dto.items ? {
            deleteMany: {},
            create: dto.items.map((item) => ({
              itemId: itemMap!.get(item.itemId)!.id,
              quantity: item.quantity,
              unit: item.unit || itemMap!.get(item.itemId)!.unit,
            })),
          } : undefined,
        },
        include: this.include(),
      });
      return this.mapOrder(row);
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['orders', 'partners', 'operations'], 'orders.updated', { meta: { id } });
      await this.auditService.logItemAction(actorId, 'UPDATE', 'Order', id, {}, actorUsername);
    }
    return execution.value;
  }

  async complete(id: string, warehouseId: string | undefined, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const execution = await executeIdempotently(this.prisma, actorId, 'orders.complete', idempotencyKey, { id, warehouseId }, async (tx) => {
      const existing = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new NotFoundException(`Order not found: ${id}`);
      if (existing.status === 'cancelled') throw new ConflictException('Cancelled orders cannot be completed');
      const row = await tx.order.update({ where: { id }, data: { status: 'completed', warehouseId: warehouseId || undefined }, include: this.include() });
      return this.mapOrder(row);
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['orders', 'operations'], 'orders.completed', { meta: { id } });
      await this.auditService.logItemAction(actorId, 'COMPLETE', 'Order', id, {}, actorUsername);
    }
    return execution.value;
  }

  async remove(id: string, actorId = 'system', actorUsername = 'system', idempotencyKey?: string, scope = 'default') {
    const execution = await executeIdempotently(this.prisma, actorId, 'orders.delete', idempotencyKey, { id }, async (tx) => {
      const existing = await tx.order.findUnique({ where: { id }, select: { id: true, warehouseId: true } });
      if (!existing) throw new NotFoundException(`Order not found: ${id}`);
      if (scope !== 'all' && existing.warehouseId !== scope) throw new ForbiddenException('Order is outside the permitted warehouse scope');
      await tx.order.delete({ where: { id } });
      return { id };
    });
    if (!execution.replayed) {
      this.realtimeService.emitSync(['orders', 'operations'], 'orders.deleted', { meta: { id } });
      await this.auditService.logItemAction(actorId, 'DELETE', 'Order', id, {}, actorUsername);
    }
    return { deleted: 1 };
  }
}
