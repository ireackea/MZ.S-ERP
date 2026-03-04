// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Transaction as DbTransaction } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { DeleteTransactionsDto } from './dto/delete-transactions.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

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

  private toDate(value: string | Date): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid transaction date');
    }
    return date;
  }

  private normalizeType(type: string): string {
    return String(type || '').trim().toLowerCase();
  }

  private toDelta(type: string, quantity: number): number {
    if (!Number.isFinite(quantity)) return 0;

    const normalized = this.normalizeType(type);
    const inboundKeywords = [
      'in',
      'purchase',
      'incoming',
      'import',
      'production',
      '7�"�7�"�7�"�#���"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
      '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
      '7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
    ];
    const outboundKeywords = [
      'out',
      'sale',
      'outgoing',
      'export',
      '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
      '7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�����',
    ];

    if (inboundKeywords.some((keyword) => normalized.includes(keyword))) return quantity;
    if (outboundKeywords.some((keyword) => normalized.includes(keyword))) return -quantity;

    return quantity;
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
    const timestamp = row.timestamp == null ? row.date.getTime() : Number(row.timestamp);

    return {
      id: row.publicId,
      date: row.date.toISOString().split('T')[0],
      itemId: row.item.publicId || String(row.itemId),
      warehouseId: row.warehouseId || undefined,
      warehouseInvoice: row.warehouseInvoice || '',
      supplierInvoice: row.supplierInvoice || undefined,
      type: row.type,
      quantity: this.toNumber(row.quantity) ?? 0,
      supplierNet: this.toNumber(row.supplierNet),
      difference: this.toNumber(row.difference),
      packageCount: this.toNumber(row.packageCount),
      weightSlip: row.weightSlip || undefined,
      salaryOfWorker: this.toNumber(row.salaryOfWorker),
      supplierOrReceiver: row.supplierOrReceiver,
      truckNumber: row.truckNumber || undefined,
      trailerNumber: row.trailerNumber || undefined,
      driverName: row.driverName || undefined,
      entryTime: row.entryTime || undefined,
      exitTime: row.exitTime || undefined,
      unloadingRuleId: row.unloadingRuleId || undefined,
      unloadingDuration: row.unloadingDuration || undefined,
      delayDuration: row.delayDuration || undefined,
      delayPenalty: this.toNumber(row.delayPenalty),
      calculatedFine: this.toNumber(row.calculatedFine),
      notes: row.notes || undefined,
      attachmentData: row.attachmentData || undefined,
      attachmentName: row.attachmentName || undefined,
      attachmentType: row.attachmentType || undefined,
      googleDriveLink: row.googleDriveLink || undefined,
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

  async list(dto: ListTransactionsDto) {
    const page = Math.max(1, Number(dto.page || 1));
    const limit = Math.min(10000, Math.max(1, Number(dto.limit || 500)));
    const skip = (page - 1) * limit;

    try {
      const where: Prisma.TransactionWhereInput = {};

      if (dto.type) where.type = dto.type;

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
      console.error('7�"�7�"�7�"�#�⬑"�7��"7�"�#����� Transaction list DB failure:', dbError?.message || dbError);
      return {
        data: [],
        total: 0,
        page,
        limit,
        warning: 'Database error or table missing',
      } as any;
    }
  }

  async getById(id: string) {
    const identifier = String(id || '').trim();
    if (!identifier) throw new BadRequestException('Transaction id is required');

    const row = await this.prisma.transaction.findFirst({
      where: this.transactionWhereByIdentifier(identifier),
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
    forcedPublicId?: string,
  ): Prisma.TransactionCreateInput {
    const quantity = Number(dto.quantity ?? 0);

    return {
      publicId: forcedPublicId || String(dto.publicId || dto.id || '').trim() || randomUUID(),
      date: this.toDate(dto.date),
      item: { connect: { id: itemId } },
      warehouseId: dto.warehouseId,
      warehouseInvoice: dto.warehouseInvoice,
      supplierInvoice: dto.supplierInvoice,
      type: dto.type,
      quantity,
      supplierNet: dto.supplierNet,
      difference: dto.difference,
      packageCount: dto.packageCount,
      weightSlip: dto.weightSlip,
      salaryOfWorker: dto.salaryOfWorker,
      supplierOrReceiver: dto.supplierOrReceiver,
      truckNumber: dto.truckNumber,
      trailerNumber: dto.trailerNumber,
      driverName: dto.driverName,
      entryTime: dto.entryTime,
      exitTime: dto.exitTime,
      unloadingRuleId: dto.unloadingRuleId,
      unloadingDuration: dto.unloadingDuration,
      delayDuration: dto.delayDuration,
      delayPenalty: dto.delayPenalty,
      calculatedFine: dto.calculatedFine,
      notes: dto.notes,
      attachmentData: dto.attachmentData,
      attachmentName: dto.attachmentName,
      attachmentType: dto.attachmentType,
      googleDriveLink: dto.googleDriveLink,
      createdByUserId: dto.createdByUserId,
      timestamp: dto.timestamp == null ? undefined : BigInt(Math.floor(dto.timestamp)),
    };
  }

  async createOne(dto: CreateTransactionDto) {
    const result = await this.createMany([dto]);
    if (!result.data.length) {
      throw new BadRequestException('Failed to create transaction');
    }
    return result.data[0];
  }

  async createMany(payload: CreateTransactionDto[]) {
    if (!Array.isArray(payload) || payload.length === 0) {
      return { data: [], total: 0 };
    }

    const rows = await this.prisma.$transaction(async (tx) => {
      const createdRows: TxWithItem[] = [];

      for (const dto of payload) {
        const itemId = await this.resolveItemId(dto.itemId, tx);
        const quantity = Number(dto.quantity ?? 0);
        const delta = this.toDelta(dto.type, quantity);

        const created = await tx.transaction.create({
          data: this.buildCreateData(dto, itemId),
          include: this.includeItem(),
        });

        await tx.item.update({
          where: { id: itemId },
          data: {
            currentStock: { increment: delta },
          },
        });

        createdRows.push(created as TxWithItem);
      }

      return createdRows;
    });

    const response = {
      data: rows.map((row) => this.mapToFrontend(row)),
      total: rows.length,
    };
    if (response.total > 0) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.created',
        { meta: { count: response.total } },
      );
    }
    return response;
  }

  async migrateFromLocal(payload: CreateTransactionDto[]) {
    if (!Array.isArray(payload) || payload.length === 0) {
      return { total: 0, migrated: 0, skipped: 0, data: [] };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const createdRows: TxWithItem[] = [];
      let skipped = 0;

      for (let index = 0; index < payload.length; index += 1) {
        const dto = payload[index];
        const preferredPublicId = this.resolvePreferredPublicId(dto, index);

        const exists = await tx.transaction.findUnique({
          where: { publicId: preferredPublicId },
          select: { id: true },
        });

        if (exists) {
          skipped += 1;
          continue;
        }

        const itemId = await this.resolveItemId(dto.itemId, tx);
        const quantity = Number(dto.quantity ?? 0);
        const delta = this.toDelta(dto.type, quantity);

        const created = await tx.transaction.create({
          data: this.buildCreateData(dto, itemId, preferredPublicId),
          include: this.includeItem(),
        });

        await tx.item.update({
          where: { id: itemId },
          data: { currentStock: { increment: delta } },
        });

        createdRows.push(created as TxWithItem);
      }

      return {
        data: createdRows,
        skipped,
      };
    });

    const response = {
      total: payload.length,
      migrated: result.data.length,
      skipped: result.skipped,
      data: result.data.map((row) => this.mapToFrontend(row)),
    };
    if (response.migrated > 0) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.migrated',
        { meta: { migrated: response.migrated, skipped: response.skipped } },
      );
    }
    return response;
  }

  async updateById(id: string, dto: UpdateTransactionDto) {
    const identifier = String(id || '').trim();
    if (!identifier) throw new BadRequestException('Transaction id is required');

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findFirst({
        where: this.transactionWhereByIdentifier(identifier),
      });

      if (!existing) {
        throw new NotFoundException(`Transaction not found: ${identifier}`);
      }

      const nextItemId = dto.itemId ? await this.resolveItemId(dto.itemId, tx) : existing.itemId;

      const nextType = dto.type ?? existing.type;
      const nextQuantity = dto.quantity == null ? Number(existing.quantity) : Number(dto.quantity);
      const oldDelta = this.toDelta(existing.type, Number(existing.quantity));
      const newDelta = this.toDelta(nextType, nextQuantity);

      if (existing.itemId === nextItemId) {
        const netDelta = newDelta - oldDelta;
        if (netDelta !== 0) {
          await tx.item.update({
            where: { id: existing.itemId },
            data: { currentStock: { increment: netDelta } },
          });
        }
      } else {
        await tx.item.update({
          where: { id: existing.itemId },
          data: { currentStock: { increment: -oldDelta } },
        });
        await tx.item.update({
          where: { id: nextItemId },
          data: { currentStock: { increment: newDelta } },
        });
      }

      const row = await tx.transaction.update({
        where: { id: existing.id },
        data: {
          date: dto.date ? this.toDate(dto.date) : undefined,
          item: dto.itemId ? { connect: { id: nextItemId } } : undefined,
          warehouseId: dto.warehouseId,
          warehouseInvoice: dto.warehouseInvoice,
          supplierInvoice: dto.supplierInvoice,
          type: dto.type,
          quantity: dto.quantity,
          supplierNet: dto.supplierNet,
          difference: dto.difference,
          packageCount: dto.packageCount,
          weightSlip: dto.weightSlip,
          salaryOfWorker: dto.salaryOfWorker,
          supplierOrReceiver: dto.supplierOrReceiver,
          truckNumber: dto.truckNumber,
          trailerNumber: dto.trailerNumber,
          driverName: dto.driverName,
          entryTime: dto.entryTime,
          exitTime: dto.exitTime,
          unloadingRuleId: dto.unloadingRuleId,
          unloadingDuration: dto.unloadingDuration,
          delayDuration: dto.delayDuration,
          delayPenalty: dto.delayPenalty,
          calculatedFine: dto.calculatedFine,
          notes: dto.notes,
          attachmentData: dto.attachmentData,
          attachmentName: dto.attachmentName,
          attachmentType: dto.attachmentType,
          googleDriveLink: dto.googleDriveLink,
          createdByUserId: dto.createdByUserId,
          timestamp: dto.timestamp == null ? undefined : BigInt(Math.floor(dto.timestamp)),
        },
        include: this.includeItem(),
      });

      return row as TxWithItem;
    });

    const response = this.mapToFrontend(updated);
    this.realtimeService.emitSync(
      ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
      'transactions.updated',
      { meta: { id: response.id } },
    );
    return response;
  }

  async deleteOne(id: string) {
    return this.deleteMany({ ids: [id] });
  }

  async deleteMany(dto: DeleteTransactionsDto) {
    const ids = Array.from(new Set((dto.ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) return { deleted: 0 };

    const idNumbers = ids.map((id) => Number(id)).filter((value) => Number.isInteger(value));

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.transaction.findMany({
        where: {
          OR: [
            { publicId: { in: ids } },
            ...(idNumbers.length ? [{ id: { in: idNumbers } }] : []),
          ],
        },
      });

      for (const row of rows) {
        const delta = this.toDelta(row.type, Number(row.quantity));
        await tx.item.update({
          where: { id: row.itemId },
          data: { currentStock: { increment: -delta } },
        });
      }

      const deleted = await tx.transaction.deleteMany({
        where: {
          OR: [
            { publicId: { in: ids } },
            ...(idNumbers.length ? [{ id: { in: idNumbers } }] : []),
          ],
        },
      });

      return deleted.count;
    });

    if (result > 0) {
      this.realtimeService.emitSync(
        ['transactions', 'operations', 'dashboard', 'items', 'stocktaking'],
        'transactions.deleted',
        { meta: { count: result } },
      );
    }
    return { deleted: result };
  }

  async getComputedBalances(financialYear?: number) {
    const year = Number(financialYear) || new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    try {
      const [items, openingRows, transactionRows] = await Promise.all([
      this.prisma.item.findMany({
        select: {
          id: true,
          publicId: true,
          name: true,
        },
        orderBy: { name: 'asc' },
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
        const delta = this.toDelta(row.type, Number(row.quantity ?? 0));
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
      console.error('7�"�7�"�7�"�#�⬑"�7��"7�"�#����� getComputedBalances DB failure:', dbError?.message || dbError);
      return {
        financialYear: year,
        total: 0,
        data: [],
        warning: 'Database error or table missing',
      } as any;
    }
  }
}
