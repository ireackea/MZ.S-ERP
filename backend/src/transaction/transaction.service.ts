// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
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

  private canonicalOperationType(type: string): string {
    const raw = String(type || '').trim();
    if (!raw) return raw;

    const normalized = this.normalizeType(raw);
    const aliases: Array<{ canonical: string; values: string[] }> = [
      {
        canonical: 'وارد',
        values: ['1', 'in', 'incoming', 'import', 'purchase', 'receive', 'receipt', 'وارد', 'استلام', 'ادخال', 'إدخال', 'شراء', 'مشتريات'],
      },
      {
        canonical: 'صادر',
        values: ['2', 'out', 'outgoing', 'export', 'sale', 'dispatch', 'consumption', 'صادر', 'صرف', 'بيع', 'مبيعات', 'خروج', 'تحويل_صادر'],
      },
      {
        canonical: 'انتاج',
        values: ['3', 'prod', 'production', 'manufacturing', 'انتاج', 'إنتاج', 'تصنيع'],
      },
      {
        canonical: 'هالك',
        values: ['4', 'waste', 'damaged', 'scrap', 'loss', 'هالك', 'تالف'],
      },
      {
        canonical: 'مرتجع',
        values: ['5', 'return', 'returned', 'مرتجع', 'إرجاع', 'ارجاع'],
      },
    ];

    for (const entry of aliases) {
      if (entry.values.some((value) => normalized.includes(value.toLowerCase()))) {
        return entry.canonical;
      }
    }

    return raw;
  }

  private expandOperationTypeAliases(type: string): string[] {
    switch (this.canonicalOperationType(type)) {
      case 'وارد':
        return ['وارد', 'استلام', 'import', 'incoming', 'in', 'purchase'];
      case 'صادر':
        return ['صادر', 'صرف', 'تحويل_صادر', 'export', 'outgoing', 'out', 'sale'];
      case 'انتاج':
        return ['انتاج', 'إنتاج', 'تصنيع', 'production', 'manufacturing'];
      case 'هالك':
        return ['هالك', 'تالف', 'waste', 'damaged', 'scrap'];
      case 'مرتجع':
        return ['مرتجع', 'إرجاع', 'ارجاع', 'return', 'returned'];
      default:
        return [String(type || '').trim()].filter(Boolean);
    }
  }

  private toDelta(type: string, quantity: number): number {
    if (!Number.isFinite(quantity)) return 0;

    const canonical = this.canonicalOperationType(type);
    if (canonical === 'وارد' || canonical === 'انتاج' || canonical === 'مرتجع') return Math.abs(quantity);
    if (canonical === 'صادر' || canonical === 'هالك') return -Math.abs(quantity);

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

  private async resolveUnloadingRuleId(
    unloadingRuleIdentifier: string | null | undefined,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | undefined> {
    const normalized = String(unloadingRuleIdentifier || '').trim();
    if (!normalized) {
      return undefined;
    }

    const unloadingRule = await client.unloadingRule.findUnique({
      where: { id: normalized },
      select: { id: true },
    });

    if (!unloadingRule) {
      throw new NotFoundException(`Unloading rule not found: ${normalized}`);
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

    const unloadingRules = await client.unloadingRule.findMany({
      where: {
        id: { in: normalizedIdentifiers },
      },
      select: {
        id: true,
      },
    });

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

  private async applyStockDeltas(
    client: Prisma.TransactionClient,
    stockDeltaByItemId: Map<number, number>,
  ): Promise<void> {
    for (const [itemId, delta] of stockDeltaByItemId.entries()) {
      if (!Number.isFinite(delta) || delta === 0) {
        continue;
      }

      await client.item.update({
        where: { id: itemId },
        data: {
          currentStock: { increment: delta },
        },
      });
    }
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
      type: this.canonicalOperationType(row.type),
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
    unloadingRuleId?: string,
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
      type: this.canonicalOperationType(dto.type),
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
      unloadingRule: unloadingRuleId ? { connect: { id: unloadingRuleId } } : undefined,
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

    const itemIdMap = await this.resolveItemIdMap(payload.map((dto) => dto.itemId));
    const unloadingRuleIdMap = await this.resolveUnloadingRuleIdMap(payload.map((dto) => dto.unloadingRuleId));

    const rows = await this.prisma.$transaction(async (tx) => {
      const createdRows: TxWithItem[] = [];
      const stockDeltaByItemId = new Map<number, number>();

      for (const dto of payload) {
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
          data: this.buildCreateData(dto, itemId, unloadingRuleId),
          include: this.includeItem(),
        });

        stockDeltaByItemId.set(itemId, (stockDeltaByItemId.get(itemId) || 0) + delta);

        createdRows.push(created as TxWithItem);
      }

      await this.applyStockDeltas(tx, stockDeltaByItemId);

      return createdRows;
    }, {
      maxWait: 10_000,
      timeout: 20_000,
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

    const itemIdMap = await this.resolveItemIdMap(payload.map((dto) => dto.itemId));
    const unloadingRuleIdMap = await this.resolveUnloadingRuleIdMap(payload.map((dto) => dto.unloadingRuleId));

    const result = await this.prisma.$transaction(async (tx) => {
      const createdRows: TxWithItem[] = [];
      const stockDeltaByItemId = new Map<number, number>();
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
          data: this.buildCreateData(dto, itemId, unloadingRuleId, preferredPublicId),
          include: this.includeItem(),
        });

        stockDeltaByItemId.set(itemId, (stockDeltaByItemId.get(itemId) || 0) + delta);

        createdRows.push(created as TxWithItem);
      }

      await this.applyStockDeltas(tx, stockDeltaByItemId);

      return {
        data: createdRows,
        skipped,
      };
    }, {
      maxWait: 10_000,
      timeout: 20_000,
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
      const nextUnloadingRuleId = dto.unloadingRuleId === undefined
        ? existing.unloadingRuleId || undefined
        : await this.resolveUnloadingRuleId(dto.unloadingRuleId, tx);

      const nextType = dto.type == null ? this.canonicalOperationType(existing.type) : this.canonicalOperationType(dto.type);
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
          type: dto.type === undefined ? undefined : this.canonicalOperationType(dto.type),
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
          unloadingRule: dto.unloadingRuleId === undefined
            ? undefined
            : nextUnloadingRuleId
              ? { connect: { id: nextUnloadingRuleId } }
              : { disconnect: true },
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
