// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'node:fs';
import { unlink, stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';
import { PrismaService } from '../prisma.service';
import { SyncItemDto } from './dto/sync-items.dto';
import { RealtimeService } from '../realtime/realtime.service';
import { serializeDecimal } from '../common/decimal';
import { AuditService } from '../audit/audit.service';
import { buildAuditRow } from '../audit/audit-row';
import { Prisma } from '@prisma/client';
import {
  UPLOAD_ROOT,
  assertRealImageContent,
  buildAttachmentName,
  resolveStoredPath,
  type SafeFileName,
} from './attachment-safety';

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

  private itemWriteData(dto: CreateItemDto | UpdateItemDto) {
    return {
      code: dto.code === undefined ? undefined : dto.code?.trim() || null,
      barcode: dto.barcode === undefined ? undefined : dto.barcode?.trim() || null,
      name: dto.name.trim(),
      unit: dto.unit?.trim() || null,
      category: dto.category?.trim() || null,
      minLimit: dto.minLimit,
      maxLimit: dto.maxLimit,
      orderLimit: dto.orderLimit,
      packageWeight: dto.packageWeight,
      description: dto.description?.trim() || null,
    };
  }

  private responseSelect() {
    return {
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
      // FC-ITEM-001 — the stored attachment reference was being written to the
      // DB but never selected, so a client could upload an image and then never
      // read its URL back.
      imageUrl: true,
      attachments: true,
      // The saved catalog rank. Selected because the client sorts "manual" by the
      // order the server hands out, so withholding it here would make the saved
      // order unreachable no matter what the column holds.
      sortOrder: true,
    } as const;
  }

  private toApiItem(row: any) {
    // FC-DATA-001 — the Prisma Decimal columns leave the API as strings, not
    // `Number(...)`. A float would re-introduce the very drift the ledger
    // invariant prevents, and JSON would render large values in exponent form.
    return {
      ...row,
      minLimit: serializeDecimal(row.minLimit),
      maxLimit: serializeDecimal(row.maxLimit),
      orderLimit: serializeDecimal(row.orderLimit),
      packageWeight: serializeDecimal(row.packageWeight),
      currentStock: serializeDecimal(row.currentStock),
    };
  }

  private emitItemsChanged(action: string, count: number) {
    if (count <= 0) return;
    this.realtimeService.emitSync(
      ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
      `items.${action}`,
      { meta: { count } },
    );
  }

  /**
   * The rank a newly inserted row should take: one past the highest rank in use.
   *
   * Three things depend on this being the *next* rank and not the column default.
   * A row left at the default shares its rank with every other row inserted by a
   * path that did not set one, and the read path breaks that tie by id — so which
   * of two imported rows comes first is decided by the order the database happened
   * to return them in. An operator who arranged 500 items in a spreadsheet and
   * then watched them come back alphabetically was watching exactly that. It is
   * also why a new item jumped to its alphabetical position after the first
   * refresh: it was sharing a rank with the rest of its import.
   *
   * `coalesce(max, -1)` so the first item in an empty catalog gets rank 0 rather
   * than the default.
   */
  private async nextSortOrder(client: PrismaService | Prisma.TransactionClient = this.prisma): Promise<number> {
    const aggregate = await client.item.aggregate({ _max: { sortOrder: true } });
    return (aggregate._max.sortOrder ?? -1) + 1;
  }

  async create(dto: CreateItemDto, userId?: string, actorUsername?: string) {
    const publicId = dto.publicId.trim();
    if (!publicId) throw new BadRequestException('publicId is required');
    if (dto.minLimit != null && dto.maxLimit != null && dto.maxLimit < dto.minLimit) {
      throw new BadRequestException('maxLimit must be greater than or equal to minLimit');
    }

    const created = await this.prisma.item.create({
      data: {
        publicId,
        // A new item joins the end of the catalog, in the order it was added.
        sortOrder: await this.nextSortOrder(),
        code: dto.code?.trim() || null,
        codeGenerated: dto.code?.trim() ? false : undefined,
        barcode: dto.barcode?.trim() || null,
        name: dto.name.trim(),
        unit: dto.unit?.trim() || null,
        category: dto.category?.trim() || 'غير مصنف',
        minLimit: dto.minLimit ?? 0,
        maxLimit: dto.maxLimit ?? 1000,
        orderLimit: dto.orderLimit,
        packageWeight: dto.packageWeight,
        description: dto.description?.trim() || null,
        createdBy: userId || undefined,
      },
      select: this.responseSelect(),
    });

    await this.auditService.logItemAction(
      userId || 'system',
      'CREATE',
      'Item',
      String(created.publicId),
      { count: 1, items: [{ publicId: String(created.publicId), name: created.name }] },
      actorUsername,
    );
    this.emitItemsChanged('created', 1);
    return this.toApiItem(created);
  }

  async getByPublicId(publicId: string) {
    const item = await this.prisma.item.findUnique({ where: { publicId }, select: this.responseSelect() });
    if (!item) throw new NotFoundException(`Item not found: ${publicId}`);
    return this.toApiItem(item);
  }

  async update(publicId: string, dto: UpdateItemDto, userId?: string, actorUsername?: string) {
    if (dto.minLimit != null && dto.maxLimit != null && dto.maxLimit < dto.minLimit) {
      throw new BadRequestException('maxLimit must be greater than or equal to minLimit');
    }
    const existing = await this.prisma.item.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException(`Item not found: ${publicId}`);

    const updated = await this.prisma.item.update({
      where: { publicId },
      data: {
        ...this.itemWriteData(dto),
        codeGenerated: dto.code === undefined ? undefined : dto.code?.trim() ? false : undefined,
        updatedBy: userId || undefined,
      },
      select: this.responseSelect(),
    });

    await this.auditService.logItemAction(
      userId || 'system',
      'UPDATE',
      'Item',
      publicId,
      { count: 1, items: [{ publicId, name: updated.name }] },
      actorUsername,
    );
    this.emitItemsChanged('updated', 1);
    return this.toApiItem(updated);
  }

  /**
   * Persists the catalog order and reports what actually changed.
   *
   * The "حفظ ترتيب الأصناف" button used to write a Zustand array and nothing
   * else, so the order died on every reload. This is the column that makes the
   * claim true, and the audit row that makes it checkable afterwards.
   *
   * Three decisions worth stating, because each of them is a way this could
   * quietly lose an operator's work:
   *
   * 1. **An id that does not resolve is a 400, not a skip.** Silently dropping
   *    the entries we could not find is how a "save" reports success while
   *    quietly discarding part of the order — the client would then render an
   *    order the database never agreed to.
   * 2. **Items the client did not send keep their relative order and go last.**
   *    The list endpoint caps at 1000 rows, so a catalog larger than that cannot
   *    be described in full. Appending the remainder deterministically means a
   *    partial save is a true prefix rather than a scramble.
   * 3. **The audit row is written on the transaction client.** The same lesson as
   *    the system reset: a record written on a second connection commits even when
   *    the work it describes is rolled back, which produces a catalog that claims
   *    an order nobody can find in the log.
   */
  async reorderItems(
    orderedPublicIds: string[],
    actor: { userId?: string; username?: string; role?: string; ipAddress?: string },
  ) {
    // Refuse an empty order before any SQL.
    //
    // An empty array reaches `Prisma.join`, which throws on zero elements, and
    // the caller got a 500 for a request that was simply wrong. The DTO's
    // `ArrayMaxSize` has no lower bound, so an empty list is valid input as far as
    // validation is concerned, which makes this the only place that can catch it.
    if (!Array.isArray(orderedPublicIds) || orderedPublicIds.length === 0) {
      throw new BadRequestException({
        code: 'ITEM_ORDER_EMPTY',
        message: 'ترتيب فارغ لا يمكن حفظه: أرسل صنفاً واحداً على الأقل.',
        detail: { received: Array.isArray(orderedPublicIds) ? 0 : 'not-an-array' },
      });
    }

    const total = await this.prisma.item.count();

    return this.prisma.$transaction(async (tx) => {
      const found = await tx.item.findMany({
        where: { publicId: { in: orderedPublicIds } },
        select: { publicId: true, sortOrder: true },
      });

      const resolved = new Set(found.map((row) => row.publicId));
      const unknown = orderedPublicIds.filter((id) => !resolved.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException({
          code: 'ITEM_ORDER_UNKNOWN_IDS',
          message:
            `${unknown.length} of the ${orderedPublicIds.length} submitted ids do not exist, so the order was not saved.`,
          detail: { unknownPublicIds: unknown.slice(0, 20), unknownCount: unknown.length },
        });
      }

      // One statement for the ranked rows. A loop of `update` calls would be 648
      // round trips inside a transaction that is holding a lock on the whole
      // catalog; a single UPDATE ... FROM VALUES is one round trip and one lock.
      const ranked = orderedPublicIds.map((publicId, index) => ({ publicId, rank: index }));
      await tx.$executeRaw`
        UPDATE "public"."Item" AS item
        SET "sortOrder" = ranked.rank
        FROM (VALUES ${Prisma.join(
          ranked.map((row) => Prisma.sql`(${row.publicId}, ${row.rank}::int)`),
        )}) AS ranked("publicId", rank)
        WHERE item."publicId" = ranked."publicId"
      `;

      // Everything the client could not send, deterministically after the part
      // it did. Ordered by the rank it already had, so a partial save preserves
      // the existing sequence instead of re-alphabetising the tail.
      // The exclusion list is an explicit `IN (...)`, not `= ANY(${array}::text[])`.
      //
      // Prisma binds a JavaScript array parameter as a single value, so the
      // `::text[]` cast applies to that value rather than to the elements. It
      // happened to work for text here, which is exactly why it is worth removing:
      // the identical statement over an integer column fails with
      // `operator does not exist: integer = text`, and the shape that reads
      // correctly is the one that casts each element.
      const listed = Prisma.join(
        orderedPublicIds.map((publicId) => Prisma.sql`${publicId}::text`),
      );
      const appended = await tx.$executeRaw`
        WITH rest AS (
          SELECT "id",
                 ${BigInt(orderedPublicIds.length)}
                   + ROW_NUMBER() OVER (ORDER BY "sortOrder" ASC NULLS LAST, "name" ASC, "id" ASC)
                   - 1 AS rank
          FROM "public"."Item"
          WHERE "publicId" IS NULL OR NOT ("publicId" IN (${listed}))
        )
        UPDATE "public"."Item" AS item
        SET "sortOrder" = rest.rank
        FROM rest
        WHERE item."id" = rest."id"
      `;

      const moved = found.filter(
        (row, index) => row.sortOrder !== orderedPublicIds.indexOf(row.publicId),
      ).length;

      await tx.auditLog.create({
        data: buildAuditRow({
          actorId: actor.userId ?? 'system',
          actorUsername: actor.username ?? 'system',
          actorRole: actor.role ?? 'unknown',
          action: 'ITEM_ORDER_SAVED',
          targetResource: 'item_order',
          entityType: 'Item',
          entityId: 'catalog',
          status: 'success',
          message:
            `catalog order saved: ${orderedPublicIds.length} ranked, ${appended} appended`,
          metadata: {
            ranked: orderedPublicIds.length,
            appended,
            moved,
            catalogSize: total,
            first: orderedPublicIds[0] ?? null,
            last: orderedPublicIds[orderedPublicIds.length - 1] ?? null,
          },
          ipAddress: actor.ipAddress || undefined,
        }),
      });

      this.emitItemsChanged('reordered', moved || orderedPublicIds.length);
      return {
        success: true,
        ranked: orderedPublicIds.length,
        appended,
        moved,
        catalogSize: total,
      };
    });
  }

  async syncItems(items: SyncItemDto[], userId?: string, actorUsername?: string) {
    const results = [];
    const isUpdate = items.length > 0 && await this.prisma.item.findUnique({ where: { publicId: items[0].publicId } });

    // One rank per created row, ascending, so a batch of manual adds keeps the
    // order they were entered in. Read once rather than per item, because the
    // alternative is an aggregate per row inside the loop.
    let nextRank = await this.nextSortOrder();

    for (const item of items) {
      const normalizedCode =
        item.code == null || String(item.code).trim() === ''
          ? null
          : String(item.code).trim();

      // Whether this row will be created or updated decides whether it consumes
      // a rank. The upsert's return value does not say which branch ran, and
      // advancing unconditionally would leave a hole in the sequence for every
      // updated item — holes are what make "the ranks are dense" stop being true
      // and let two rows end up tied later.
      const existing = await this.prisma.item.findUnique({
        where: { publicId: item.publicId },
        select: { id: true },
      });

      const result = await this.prisma.item.upsert({
        where: { publicId: item.publicId },
        update: {
          // `sortOrder` is deliberately absent. An update is a content change,
          // not a request to move the item, and overwriting the rank here is how
          // a saved catalog order gets silently reshuffled by an unrelated edit.
          barcode: item.barcode,
          name: item.name,
          unit: item.unit,
          category: item.category,
          minLimit: item.minLimit,
          maxLimit: item.maxLimit,
          orderLimit: item.orderLimit,
          packageWeight: item.packageWeight,
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
          sortOrder: nextRank,
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
          description: item.description,
          createdBy: userId || undefined,
        },
      });
      // Only a created row consumed a rank. An update left the item where it was.
      if (!existing) nextRank += 1;
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
        select: this.responseSelect(),
        // The saved catalog order, not the alphabet.
        //
        // The tie-break is `id`, not `name`, and that is the difference between
        // "the operator's order survived" and "the import worked". Rows are only
        // ever given an equal rank by a bug, and when that happened the tie was
        // broken alphabetically — so a spreadsheet arranged by hand came back
        // A-Z while the import reported success. Breaking ties by insertion order
        // degrades to the order the rows were actually added in, which is the
        // only fallback an operator can still make sense of.
        //
        // It also keeps a paginated walk from repeating or skipping a row, and
        // means the first page is a *prefix* of the true order.
        orderBy: [{ sortOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.item.count({ where }),
    ]);

    const data = rows.map((row) => this.toApiItem(row));

    return {
      data,
      total,
      page: Math.floor(skip / take) + 1,
      limit: take,
      totalPages: Math.ceil(total / take),
    };
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
        description,
        createdBy: userId || undefined,
      });
    }

    // The rank the first imported row takes, computed once before the insert loop.
    //
    // This is the whole reason the "حفظ ترتيب الأصناف" button was built, and it
    // did not work: `createImportRow` wrote no `sortOrder` at all, so every
    // imported row took the column default of 1000000, and the read path broke
    // that tie by name. An operator who arranged 500 rows in a spreadsheet got
    // them back A-Z, and the import reported success.
    //
    // `validRows` is already in file order — the loop that fills it appends, and
    // nothing sorts it. The position in that array is the file order, which is
    // not the same as `rowNumber`: `rowNumber` is the sheet row and drifts when
    // the sheet has blank lines, while the index is dense and always correct.
    const baseImportRank = await this.nextSortOrder();

    // The rank is passed in rather than captured from a counter, because these
    // creates are handed to `$transaction` as a list of promises. A closure
    // mutating a shared counter would advance it for rows whose transaction then
    // rolled back, and the next import would start past a gap.
    const createImportRow = (row: (typeof validRows)[number], rank: number) => this.prisma.item.create({
      data: {
        publicId: `item-${randomUUID()}`,
        sortOrder: rank,
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
        description: row.description,
        createdBy: row.createdBy,
      },
    });

    for (let offset = 0; offset < validRows.length; offset += BULK_IMPORT_BATCH_SIZE) {
      const batch = validRows.slice(offset, offset + BULK_IMPORT_BATCH_SIZE);
      // `offset + index`, not a running counter: if a batch fails and its rows are
      // retried one by one, the retried rows keep the ranks their position in the
      // file earned them, and a row that never lands leaves a gap rather than
      // pulling every later row forward.
      const rankOf = (index: number) => baseImportRank + offset + index;
      try {
        const createdItems = await this.prisma.$transaction(
          batch.map((row, index) => createImportRow(row, rankOf(index))),
        );
        createdItems.forEach((created, index) => {
          results.push({ row: batch[index].rowNumber, publicId: String(created.publicId), name: created.name, status: 'created' });
        });
      } catch (batchError: any) {
        for (const [index, row] of batch.entries()) {
          try {
            const created = await createImportRow(row, rankOf(index));
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
  // FC-ITEM-001 — `file.filename` (generated by multer via attachment-safety) is
  // the single identity used for the disk path, the DB row and the response.
  // The client's original name is display text only.
  async uploadAttachment(
    publicId: string,
    file: any, // Express.Multer.File
    attachmentType: 'image' | 'file',
    userId: string,
    actorUsername: string,
    options?: { prebuilt?: SafeFileName },
  ) {
    const item = await this.prisma.item.findUnique({
      where: { publicId },
    });

    if (!item) {
      // FC-ITEM-001 — do not leave an orphaned file behind for a missing item.
      await this.discardUploadedFile(file);
      throw new NotFoundException('Item not found');
    }

    // Re-validate the real size: multer's filename callback runs before the
    // body is fully written, so the earlier check saw a placeholder.
    const built = buildAttachmentName({
      publicId,
      originalName: file?.originalname,
      mimetype: file?.mimetype,
      size: Number(file?.size) || 0,
      kind: attachmentType,
    });

    if (built.ok === false) {
      await this.discardUploadedFile(file);
      throw new BadRequestException(built.error);
    }

    // FC-ITEM-001 — the declared Content-Type is attacker-controlled, so the
    // bytes are inspected. Without this a Windows executable typed as
    // `image/png` is stored and later served back.
    if (attachmentType === 'image') {
      const contentCheck = await assertRealImageContent(
        file?.filename || built.value.storedName,
        (path) => readFile(path),
      );
      if (contentCheck.ok === false) {
        await this.discardUploadedFile(file);
        throw new BadRequestException(contentCheck.error);
      }
    }

    // The pre-built name from the interceptor is authoritative; re-deriving it
    // here would produce a different random suffix and break the disk path.
    const value: SafeFileName = options?.prebuilt && options.prebuilt.storedName === file?.filename
      ? { ...options.prebuilt, size: Number(file?.size) || options.prebuilt.size }
      : built.value;

    const storedName = file?.filename || value.storedName;
    // FC-ITEM-001 — the persisted URL points at the guarded download route.
    // There is no static file mount for /uploads, so the old path 404'd and the
    // image was effectively unreachable after a successful upload.
    const fileUrl = `/items/attachments/${encodeURIComponent(storedName)}`;

    let updateData: any = {};

    if (attachmentType === 'image') {
      updateData.imageUrl = fileUrl;
    } else {
      const existingAttachments = (item.attachments as any[]) || [];
      updateData.attachments = [
        ...existingAttachments,
        {
          id: `attach-${randomUUID()}`,
          // Display name, sanitized — never used to build a path.
          name: value.displayName,
          url: fileUrl,
          storedName,
          type: value.mimeType,
          size: value.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userId,
        },
      ];
    }

    let updatedItem: any;
    try {
      updatedItem = await this.prisma.item.update({
        where: { publicId },
        data: updateData,
      });
    } catch (error) {
      // FC-ITEM-001 — a DB failure must not leave the file orphaned on disk.
      await this.discardUploadedFile(file, storedName);
      throw error;
    }

    await this.auditService.logItemAction(
      userId,
      'ITEM_UPDATE',
      'Item',
      publicId,
      { action: 'attachment_uploaded', storedName, displayName: value.displayName, fileType: attachmentType, size: value.size },
      actorUsername,
    );

    return {
      success: true,
      url: fileUrl,
      // The generated name is the identity callers must use.
      fileName: storedName,
      originalName: value.displayName,
      type: attachmentType,
      mimeType: value.mimeType,
      size: value.size,
    };
  }

  /** FC-ITEM-001 — best-effort removal of a file we no longer reference. */
  private async discardUploadedFile(file: any, storedName?: string): Promise<void> {
    const name = storedName || file?.filename;
    if (!name) return;
    try {
      const safeName = basename(String(name));
      const target = resolveStoredPath(UPLOAD_ROOT, safeName);
      if (target) {
        await unlink(target).catch(() => undefined);
      }
    } catch {
      // Cleanup is best-effort; never mask the original error.
    }
  }

  /** FC-ITEM-001 — serves a stored attachment, refusing any path escape. */
  async serveAttachment(storedName: string, res: any): Promise<void> {
    const target = resolveStoredPath(UPLOAD_ROOT, storedName);
    if (!target) {
      throw new BadRequestException('Invalid attachment path');
    }

    let stats: any;
    try {
      stats = await stat(target);
    } catch {
      throw new NotFoundException('Attachment not found');
    }
    if (!stats.isFile()) {
      throw new NotFoundException('Attachment not found');
    }

    // Infer the type from the stored extension, never from client input.
    const extension = extname(target).toLowerCase();
    const mimeForExtension: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
      '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    res.setHeader('Content-Type', mimeForExtension[extension] || 'application/octet-stream');
    // Stored under a generated name, so a download cannot be executed inline.
    res.setHeader('Content-Disposition', `attachment; filename="${basename(target)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(stats.size));

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(target);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  }
}
