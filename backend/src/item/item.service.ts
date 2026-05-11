// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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

const MAX_BULK_IMPORT_ROWS = 15000;
const BULK_IMPORT_BATCH_SIZE = 250;

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
          packageWeight: item.packageWeight,
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
          packageWeight: item.packageWeight,
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
          packageWeight: true,
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
      packageWeight: row.packageWeight == null ? null : Number(row.packageWeight),
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
        packageWeight: true,
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
      packageWeight: row.packageWeight == null ? null : Number(row.packageWeight),
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
      packageWeight?: number;
      currentStock?: number;
      englishName?: string;
      description?: string;
      sourceRow?: number;
    }>,
    userId: string,
    actorUsername: string,
  ) {
    const results: Array<{ row: number; publicId: string; name: string; status: string }> = [];
    const errors: Array<{ row: number; error: string; field: string; message: string; value?: unknown }> = [];

    if (!Array.isArray(items)) {
      throw new BadRequestException('قائمة الأصناف مطلوبة.');
    }

    if (items.length > MAX_BULK_IMPORT_ROWS) {
      throw new BadRequestException(`الحد الأقصى للاستيراد هو ${MAX_BULK_IMPORT_ROWS} صف في العملية الواحدة.`);
    }

    const codeCounts = new Map<string, number>();
    const barcodeCounts = new Map<string, number>();
    const normalizeOptionalString = (value: unknown) => {
      const normalized = String(value ?? '').trim();
      return normalized || null;
    };
    const normalizeLookupKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const readNumber = (value: unknown, fallback: number | null) => {
      if (value == null || value === '') return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    };

    items.forEach((item) => {
      const code = normalizeLookupKey(item.code);
      const barcode = normalizeLookupKey(item.barcode);
      if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
      if (barcode) barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
    });

    const uniqueCodes = [...codeCounts.keys()];
    const uniqueBarcodes = [...barcodeCounts.keys()];
    const duplicateConditions: any[] = [];
    if (uniqueCodes.length) duplicateConditions.push({ code: { in: uniqueCodes } });
    if (uniqueBarcodes.length) duplicateConditions.push({ barcode: { in: uniqueBarcodes } });
    const existingItems = duplicateConditions.length
      ? await this.prisma.item.findMany({
          where: { OR: duplicateConditions },
          select: { code: true, barcode: true, name: true },
        })
      : [];
    const existingCodes = new Map(existingItems.filter((item) => item.code).map((item) => [normalizeLookupKey(item.code), item.name]));
    const existingBarcodes = new Map(existingItems.filter((item) => item.barcode).map((item) => [normalizeLookupKey(item.barcode), item.name]));

    const validRows: Array<{
      rowNumber: number;
      name: string;
      code: string | null;
      barcode: string | null;
      category: string;
      unit: string;
      minLimit: number;
      maxLimit: number;
      orderLimit: number | null;
      packageWeight: number | null;
      currentStock: number;
      description: string | null;
      createdBy?: string;
    }> = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const rowNumber = Number(item.sourceRow || index + 2);
      const name = String(item.name || '').trim();
      const category = String(item.category || '').trim();
      const unit = String(item.unit || '').trim();
      const code = normalizeOptionalString(item.code);
      const barcode = normalizeOptionalString(item.barcode);
      const codeKey = normalizeLookupKey(code);
      const barcodeKey = normalizeLookupKey(barcode);
      const description = String(item.description || item.englishName || '').trim() || null;
      const minLimit = readNumber(item.minLimit, 0);
      const maxLimit = readNumber(item.maxLimit, 1000);
      const orderLimit = readNumber(item.orderLimit, null);
      const packageWeight = readNumber(item.packageWeight, null);
      const currentStock = readNumber(item.currentStock, 0);

      if (!name || !category || !unit) {
        errors.push({ row: rowNumber, field: 'required', message: 'اسم الصنف والتصنيف ووحدة القياس مطلوبة.', error: 'اسم الصنف والتصنيف ووحدة القياس مطلوبة.' });
        continue;
      }

      const unsafeFormulaField = ([
        ['name', name, 'اسم الصنف'],
        ['code', code, 'كود الصنف'],
        ['barcode', barcode, 'الباركود'],
        ['category', category, 'القسم'],
        ['unit', unit, 'وحدة القياس'],
        ['description', description, 'الوصف'],
      ] as Array<[string, string | null, string]>).find(([, value]) => value != null && /^[=+\-@]/.test(String(value).trim()));
      if (unsafeFormulaField) {
        const message = `${unsafeFormulaField[2]} يبدأ برمز صيغة Excel غير آمن.`;
        errors.push({ row: rowNumber, field: unsafeFormulaField[0], message, error: message, value: unsafeFormulaField[1] });
        continue;
      }

      const numberEntries: Array<[string, number | null, string]> = [
        ['minLimit', minLimit, 'الحد الأدنى'],
        ['maxLimit', maxLimit, 'الحد الأعلى'],
        ['orderLimit', orderLimit, 'حد إعادة الطلب'],
        ['packageWeight', packageWeight, 'وزن العبوة'],
        ['currentStock', currentStock, 'الرصيد الحالي'],
      ];
      const invalidNumber = numberEntries.find(([, value]) => value != null && (!Number.isFinite(value) || value < 0 || value > 999999999.999));
      if (invalidNumber) {
        errors.push({ row: rowNumber, field: invalidNumber[0], message: `${invalidNumber[2]} غير صالح.`, error: `${invalidNumber[2]} غير صالح.`, value: invalidNumber[1] });
        continue;
      }

      if ((minLimit ?? 0) > (maxLimit ?? 1000)) {
        errors.push({ row: rowNumber, field: 'minLimit', message: 'الحد الأدنى أكبر من الحد الأعلى.', error: 'الحد الأدنى أكبر من الحد الأعلى.' });
        continue;
      }

      if (codeKey && (codeCounts.get(codeKey) || 0) > 1) {
        errors.push({ row: rowNumber, field: 'code', message: 'كود مكرر داخل ملف الاستيراد.', error: 'كود مكرر داخل ملف الاستيراد.', value: code });
        continue;
      }

      if (barcodeKey && (barcodeCounts.get(barcodeKey) || 0) > 1) {
        errors.push({ row: rowNumber, field: 'barcode', message: 'باركود مكرر داخل ملف الاستيراد.', error: 'باركود مكرر داخل ملف الاستيراد.', value: barcode });
        continue;
      }

      if (codeKey && existingCodes.has(codeKey)) {
        const message = `الكود مستخدم مسبقًا للصنف: ${existingCodes.get(codeKey)}`;
        errors.push({ row: rowNumber, field: 'code', message, error: message, value: code });
        continue;
      }

      if (barcodeKey && existingBarcodes.has(barcodeKey)) {
        const message = `الباركود مستخدم مسبقًا للصنف: ${existingBarcodes.get(barcodeKey)}`;
        errors.push({ row: rowNumber, field: 'barcode', message, error: message, value: barcode });
        continue;
      }

      validRows.push({
        rowNumber,
        name,
        code,
        barcode,
        category,
        unit,
        minLimit: minLimit ?? 0,
        maxLimit: maxLimit ?? 1000,
        orderLimit,
        packageWeight,
        currentStock: currentStock ?? 0,
        description,
        createdBy: userId || undefined,
      });
    }

    const createImportRow = (row: (typeof validRows)[number]) => this.prisma.item.create({
      data: {
        publicId: `item-${randomUUID()}`,
        code: row.code,
        codeGenerated: row.code ? false : undefined,
        barcode: row.barcode,
        name: row.name,
        unit: row.unit,
        category: row.category,
        minLimit: row.minLimit,
        maxLimit: row.maxLimit,
        orderLimit: row.orderLimit,
        packageWeight: row.packageWeight,
        currentStock: row.currentStock,
        description: row.description,
        createdBy: row.createdBy,
      },
    });

    for (let offset = 0; offset < validRows.length; offset += BULK_IMPORT_BATCH_SIZE) {
      const batch = validRows.slice(offset, offset + BULK_IMPORT_BATCH_SIZE);
      try {
        const createdItems = await this.prisma.$transaction(batch.map((row) => createImportRow(row)));
        createdItems.forEach((created, index) => {
          results.push({ row: batch[index].rowNumber, publicId: String(created.publicId), name: created.name, status: 'created' });
        });
      } catch (batchError: any) {
        for (const row of batch) {
          try {
            const created = await createImportRow(row);
            results.push({ row: row.rowNumber, publicId: String(created.publicId), name: created.name, status: 'created' });
          } catch (error: any) {
            const message = error?.code === 'P2002'
              ? 'الصنف مكرر أو يحتوي على كود/باركود مستخدم مسبقًا.'
              : error?.message || batchError?.message || 'فشل استيراد الصف.';
            errors.push({ row: row.rowNumber, field: 'row', message, error: message, value: row.name });
          }
        }
      }
    }

    if (userId && results.length > 0) {
      await this.auditService.logItemAction(
        userId,
        'IMPORT',
        'Item',
        results.map((row) => row.publicId).join(','),
        {
          count: results.length,
          failed: errors.length,
          items: results.slice(0, 100).map((row) => ({ publicId: row.publicId, name: row.name })),
          truncated: results.length > 100,
        },
        actorUsername,
      );
    }

    if (results.length > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.imported',
        { meta: { count: results.length } },
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
