// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SyncItemDto } from './dto/sync-items.dto';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';

export interface FindAllItemsParams {
  skip?: number;
  take?: number;
  search?: string;
  category?: string;
  isArchived?: boolean;
}

export interface PaginatedItemsResult {
  data: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class ItemService {
  constructor(
    private prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService,
  ) {}

  async syncItems(items: SyncItemDto[], userId?: string, actorUsername?: string) {
    const results = [];
    const isUpdate = items.length > 0 && await this.prisma.item.findUnique({ where: { publicId: items[0].publicId } });

    for (const item of items) {
      const normalizedCode =
        item.code == null || String(item.code).trim() === ''
          ? null
          : String(item.code).trim();

      const result = await this.prisma.item.upsert({
        where: { publicId: item.publicId },
        update: {
          barcode: item.barcode,
          name: item.name,
          unit: item.unit,
          category: item.category,
          minLimit: item.minLimit,
          maxLimit: item.maxLimit,
          orderLimit: item.orderLimit,
          currentStock: item.currentStock,
          description: item.description,
          updatedBy: userId || undefined,
          ...(item.code !== undefined
            ? {
                code: normalizedCode,
                codeGenerated: false,
              }
            : {}),
        },
        create: {
          publicId: item.publicId,
          code: normalizedCode,
          codeGenerated: normalizedCode ? false : undefined,
          barcode: item.barcode,
          name: item.name,
          unit: item.unit,
          category: item.category || undefined,
          minLimit: item.minLimit ?? 0,
          maxLimit: item.maxLimit ?? 1000,
          orderLimit: item.orderLimit,
          currentStock: item.currentStock ?? 0,
          description: item.description,
          createdBy: userId || undefined,
        },
      });
      results.push(result);
    }

    // Audit logging
    if (userId && results.length > 0) {
      await this.auditService.logItemAction(
        userId,
        isUpdate ? 'UPDATE' : 'CREATE',
        'Item',
        results.map(r => String(r.publicId)).join(','),
        { count: results.length, items: results.map(r => ({ publicId: r.publicId, name: r.name })) },
        actorUsername,
      );
    }

    if (results.length > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.synced',
        { meta: { count: results.length } },
      );
    }
    return { synced: results.length, total: items.length };
  }

  async findAll(params: FindAllItemsParams): Promise<PaginatedItemsResult> {
    const { skip = 0, take = 100, search, category, isArchived = false } = params;

    const where: any = {
      isArchived,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category && category !== 'all') {
      where.category = category;
    }

    const [rows, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        select: {
          id: true,
          publicId: true,
          code: true,
          barcode: true,
          name: true,
          unit: true,
          category: true,
          codeGenerated: true,
          minLimit: true,
          maxLimit: true,
          orderLimit: true,
          currentStock: true,
          description: true,
          isArchived: true,
          archivedAt: true,
          archivedBy: true,
          createdAt: true,
          updatedAt: true,
          createdBy: true,
          updatedBy: true,
        },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.item.count({ where }),
    ]);

    const data = rows.map((row) => ({
      ...row,
      minLimit: row.minLimit == null ? null : Number(row.minLimit),
      maxLimit: row.maxLimit == null ? null : Number(row.maxLimit),
      orderLimit: row.orderLimit == null ? null : Number(row.orderLimit),
      currentStock: row.currentStock == null ? null : Number(row.currentStock),
    }));

    return {
      data,
      total,
      page: Math.floor(skip / take) + 1,
      limit: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async getAll() {
    const rows = await this.prisma.item.findMany({
      select: {
        id: true,
        publicId: true,
        code: true,
        barcode: true,
        name: true,
        unit: true,
        category: true,
        codeGenerated: true,
        minLimit: true,
        maxLimit: true,
        orderLimit: true,
        currentStock: true,
        description: true,
        isArchived: true,
        archivedAt: true,
        archivedBy: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
      },
      where: { isArchived: false },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => ({
      ...row,
      minLimit: row.minLimit == null ? null : Number(row.minLimit),
      maxLimit: row.maxLimit == null ? null : Number(row.maxLimit),
      orderLimit: row.orderLimit == null ? null : Number(row.orderLimit),
      currentStock: row.currentStock == null ? null : Number(row.currentStock),
    }));
  }

  async archiveItems(publicIds: string[], userId: string, actorUsername: string) {
    const cleaned = Array.from(new Set(publicIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!cleaned.length) return { archived: 0, total: 0 };

    const now = new Date();
    const archived = await this.prisma.item.updateMany({
      where: { publicId: { in: cleaned } },
      data: {
        isArchived: true,
        archivedAt: now,
        archivedBy: userId,
      },
    });

    // Audit logging
    await this.auditService.logItemAction(
      userId,
      'ARCHIVE',
      'Item',
      cleaned.join(','),
      { count: archived.count, publicIds: cleaned },
      actorUsername,
    );

    if (archived.count > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.archived',
        { meta: { count: archived.count } },
      );
    }
    return { archived: archived.count, total: cleaned.length };
  }

  async restoreItems(publicIds: string[], userId: string, actorUsername: string) {
    const cleaned = Array.from(new Set(publicIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!cleaned.length) return { restored: 0, total: 0 };

    const restored = await this.prisma.item.updateMany({
      where: { publicId: { in: cleaned } },
      data: {
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
      },
    });

    // Audit logging
    await this.auditService.logItemAction(
      userId,
      'RESTORE',
      'Item',
      cleaned.join(','),
      { count: restored.count, publicIds: cleaned },
      actorUsername,
    );

    if (restored.count > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.restored',
        { meta: { count: restored.count } },
      );
    }
    return { restored: restored.count, total: cleaned.length };
  }

  async deletePermanently(publicIds: string[], userId: string, actorUsername: string) {
    const cleaned = Array.from(new Set(publicIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!cleaned.length) return { deleted: 0, total: 0 };

    // Get items before deletion for audit
    const itemsToDelete = await this.prisma.item.findMany({
      where: { publicId: { in: cleaned } },
      select: { publicId: true, name: true },
    });

    const deleted = await this.prisma.item.deleteMany({
      where: { publicId: { in: cleaned } },
    });

    // Audit logging
    await this.auditService.logItemAction(
      userId,
      'DELETE',
      'Item',
      cleaned.join(','),
      { count: deleted.count, items: itemsToDelete },
      actorUsername,
    );

    if (deleted.count > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.deleted',
        { meta: { count: deleted.count } },
      );
    }
    return { deleted: deleted.count, total: cleaned.length };
  }

  async deleteByPublicIds(publicIds: string[]) {
    const cleaned = Array.from(new Set(publicIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!cleaned.length) return { deleted: 0, total: 0 };

    const deleted = await this.prisma.item.deleteMany({
      where: { publicId: { in: cleaned } },
    });

    if (deleted.count > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.deleted',
        { meta: { count: deleted.count } },
      );
    }
    return { deleted: deleted.count, total: cleaned.length };
  }

  async generateMissingCodes(userId?: string, actorUsername?: string) {
    const missingItems = await this.prisma.item.findMany({
      where: {
        OR: [{ code: null }, { code: '' }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (missingItems.length === 0) {
      return {
        success: 0,
        total: 0,
        sample: [],
      };
    }

    const now = new Date();
    const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const prefix = `ITEM-${dateKey}-`;

    const existingCodes = await this.prisma.item.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });

    let nextSequence =
      existingCodes.reduce((max, row) => {
        const value = String(row.code || '');
        const suffix = value.slice(prefix.length);
        const parsed = Number(suffix);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0) + 1;

    const generatedCodes = await this.prisma.$transaction(async (tx) => {
      const generated: string[] = [];
      const updatedIds: number[] = [];
      for (const item of missingItems) {
        const code = `${prefix}${String(nextSequence).padStart(3, '0')}`;
        nextSequence += 1;
        await tx.item.update({
          where: { id: item.id },
          data: {
            code,
            codeGenerated: true,
          },
        });
        generated.push(code);
        updatedIds.push(item.id);
      }
      return { generated, updatedIds };
    });

    // Audit logging
    if (userId && generatedCodes.generated.length > 0) {
      await this.auditService.logItemAction(
        userId,
        'UPDATE',
        'Item',
        generatedCodes.updatedIds.join(','),
        { count: generatedCodes.generated.length, sample: generatedCodes.generated.slice(0, 5), prefix },
        actorUsername,
      );
    }

    if (generatedCodes.generated.length > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.codes.generated',
        { meta: { count: generatedCodes.generated.length } },
      );
    }

    return {
      success: generatedCodes.generated.length,
      total: missingItems.length,
      sample: generatedCodes.generated.slice(0, 5),
      prefix,
    };
  }

  // Phase 5: Bulk Import from Excel
  async bulkImportFromExcel(
    items: Array<{
      name: string;
      code?: string;
      barcode?: string;
      category?: string;
      unit?: string;
      minLimit?: number;
      maxLimit?: number;
      orderLimit?: number;
      currentStock?: number;
      description?: string;
    }>,
    userId: string,
    actorUsername: string,
  ) {
    const results = [];
    const errors = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (!item.name || !item.name.trim()) {
          errors.push({ row: i + 2, error: 'Name is required' });
          continue;
        }

        const publicId = `import-${Date.now()}-${i}`;
        const normalizedCode = item.code?.trim() || null;

        const result = await this.prisma.item.create({
          data: {
            publicId,
            code: normalizedCode,
            codeGenerated: normalizedCode ? false : undefined,
            barcode: item.barcode?.trim() || null,
            name: item.name.trim(),
            unit: item.unit?.trim() || 'وحدة',
            category: item.category?.trim() || 'غير مصنف',
            minLimit: item.minLimit ?? 0,
            maxLimit: item.maxLimit ?? 1000,
            orderLimit: item.orderLimit ?? null,
            currentStock: item.currentStock ?? 0,
            description: item.description?.trim() || null,
            createdBy: userId,
          },
        });

        results.push({ row: i + 2, publicId, name: result.name, status: 'success' });
      } catch (error: any) {
        errors.push({ row: i + 2, error: error.message });
      }
    }

    // Audit logging
    if (results.length > 0) {
      await this.auditService.logItemAction(
        userId,
        'CREATE',
        'Item',
        results.map(r => r.publicId).join(','),
        { imported: results.length, failed: errors.length, total: items.length },
        actorUsername,
      );
    }

    return {
      success: results.length,
      failed: errors.length,
      total: items.length,
      results,
      errors,
    };
  }

  // Phase 5: Upload Attachment (Image/File)
  async uploadAttachment(
    publicId: string,
    file: any, // Express.Multer.File
    attachmentType: 'image' | 'file',
    userId: string,
    actorUsername: string,
  ) {
    const item = await this.prisma.item.findUnique({
      where: { publicId },
    });

    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const fileName = `${publicId}-${Date.now()}-${file.originalname}`;
    const fileUrl = `/uploads/items/${fileName}`;

    let updateData: any = {};

    if (attachmentType === 'image') {
      updateData.imageUrl = fileUrl;
    } else {
      const existingAttachments = (item.attachments as any[]) || [];
      updateData.attachments = [
        ...existingAttachments,
        {
          id: `attach-${Date.now()}`,
          name: file.originalname,
          url: fileUrl,
          type: file.mimetype,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userId,
        },
      ];
    }

    const updatedItem = await this.prisma.item.update({
      where: { publicId },
      data: updateData,
    });

    // Audit logging
    await this.auditService.logItemAction(
      userId,
      'UPDATE',
      'Item',
      publicId,
      { action: 'attachment_uploaded', fileName: file.originalname, fileType: attachmentType },
      actorUsername,
    );

    return {
      success: true,
      url: fileUrl,
      fileName: file.originalname,
      type: attachmentType,
    };
  }
}
