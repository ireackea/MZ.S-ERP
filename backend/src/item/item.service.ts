// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
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

// FC-ITEM-IMPORT — the limits live in one module and are read from the
// environment, because the row cap is part of a budget shared with the JSON body
// limit and with `client_max_body_size` in both nginx configs. They were literals
// here and in the DTO, and the two could drift with nothing to notice.
import { MAX_BULK_IMPORT_ROWS, BULK_IMPORT_BATCH_SIZE } from './import-limits';
import {
  buildImportPlan,
  describeImportMode,
  fingerprintImportRows,
  type ExistingKey,
  type ImportMode,
  type ImportRowInput,
} from './import-batch';
import { executeIdempotently } from '../common/idempotency';

/** The one fold the folded unique indexes use. Anything else is a different key. */
const foldImportKey = (value: unknown): string => String(value ?? '').trim().toLowerCase();
// The row rules, shared with create, update and sync so the four write paths
// cannot drift apart. Pure functions over plain data, unit-tested without a
// database in item-normalize.test.ts.
import {
  describeOverlong,
  foldItemKey,
  normalizeItemRow,
  type NormalizedItemRow,
} from './item-normalize';


@Injectable()
export class ItemService {
  constructor(
    private prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The single write shape for every item field, shared by create, update and sync.
   *
   * Built from `normalizeItemRow` so the length limits, the whitespace handling and
   * the category fallback are the same ones the Excel import applies. It used to
   * be a hand-written object with its own copy of the trim rules, which is how the
   * two paths came to disagree: `category` was mapped to `null` here while `Item.
   * category` is `String @default("غير مصنف")`, so `{"category": ""}` passed the DTO
   * and then raised a Prisma validation error that `PrismaExceptionFilter` does not
   * catch — a 500 for a typo in a form field, a few lines away from a `create` that
   * handled it correctly.
   *
   * Only keys the caller actually supplied appear in the result, because `update`
   * merges this into an existing row and an absent key must stay absent rather than
   * becoming a default.
   */
  private itemWriteData(dto: CreateItemDto | UpdateItemDto) {
    const { row, issues, overlong } = normalizeItemRow(dto as unknown as Record<string, unknown>);

    // The single-item routes answer with the first refusal, because there is one
    // row and one form: the operator gets a message naming the field and can fix it
    // in place. The import collects all of them instead, because there are
    // fifteen thousand.
    const first = issues[0];
    if (first) {
      throw new BadRequestException(first.message);
    }
    for (const field of overlong) {
      throw new BadRequestException(describeOverlong(field));
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = row.name;
    if (dto.code !== undefined) data.code = row.code;
    if (dto.barcode !== undefined) data.barcode = row.barcode;
    if (dto.unit !== undefined) data.unit = row.unit;
    if (dto.category !== undefined) data.category = row.category;
    if (dto.minLimit !== undefined) data.minLimit = row.minLimit;
    if (dto.maxLimit !== undefined) data.maxLimit = row.maxLimit;
    if (dto.orderLimit !== undefined) data.orderLimit = row.orderLimit;
    if (dto.packageWeight !== undefined) data.packageWeight = row.packageWeight;
    if (dto.description !== undefined) data.description = row.description;
    // Present since migration 20260929110000 and absent from this list until then,
    // which is why an English name typed into the studio was accepted, normalised,
    // audited and then discarded. `create`, `update` and `syncItems` all route
    // through here, so this one line is the whole fix for every one of them.
    if (dto.englishName !== undefined) data.englishName = row.englishName;
    return data;
  }


  /**
   * The reorder threshold pair, checked on the values that will actually be stored.
   *
   * `create` compared only the two numbers in its own payload, so
   * `{ name, minLimit: 5000 }` wrote `minLimit=5000, maxLimit=1000` — the exact
   * state the import rejects. `update` compared the incoming pair only, so raising
   * one bound on a row whose other bound was lower produced an inverted pair too.
   * `syncItems` checked nothing. The status filter and the dashboard threshold both
   * read these columns, so an inverted pair is not cosmetic.
   *
   * This stays a separate method rather than folding into `itemWriteData` for one
   * reason: `syncItems` upserts, and the value that will be stored for a half-
   * present pair is the stored one, which only the database knows. Everything else
   * about the pair is now checked by `normalizeItemRow` as well, so this is the
   * narrower check on top, not the only one.
   *
   * `Decimal` is the reason for the coercion: these are `Decimal` columns, so a
   * value read back from the database and a value from a DTO have different types,
   * and comparing them directly type-errors.
   */
  private assertLimitOrder(
    minLimit: number | Prisma.Decimal | null | undefined,
    maxLimit: number | Prisma.Decimal | null | undefined,
  ): void {
    const toNumber = (value: number | Prisma.Decimal | null | undefined): number | null => {
      if (value == null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const low = toNumber(minLimit) ?? 0;
    const high = toNumber(maxLimit) ?? 1000;
    if (low > high) {

      throw new BadRequestException(
        'الحد الأدنى لا يمكن أن يتجاوز الحد الأعلى.',
      );
    }
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

  /**
   * The one place an item write announces itself.
   *
   * `emitSync` is synchronous and has no try/catch of its own: it early-returns
   * when there is no gateway and otherwise calls `gateway.broadcastSync` directly
   * (realtime.service.ts:39-50). A throw here therefore propagated into the
   * request and answered 500 for work that had already been committed. On the
   * import that produced the worst version of this bug: the rows were inserted,
   * the client was told the import failed, the list was not refreshed because the
   * refresh sits inside the same try, and no other session was told.
   *
   * The guard belongs here rather than at each call site. Six of the seven write
   * paths were hand-rolling the identical five-element scope array, so a guard
   * added to one of them would have protected one route out of seven — which is
   * how `reorderItems` ended up emitting from inside its transaction while
   * `ItemOrderProfileService` emits nothing at all despite injecting this service.
   */
  private emitItemsChanged(action: string, count: number, extraMeta?: Record<string, unknown>) {
    if (count <= 0) return;
    try {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        `items.${action}`,
        { meta: { count, ...(extraMeta || {}) } },
      );
    } catch (error) {
      // Loudly, and without failing the request. The write is already committed;
      // the only consequence of a lost announcement is that other sessions pick
      // the change up on their next load instead of immediately.
      console.error(
        `[items] committed a change but the realtime announcement failed (${action}, count=${count}):`,
        error instanceof Error ? error.message : String(error),
      );
    }
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

    // FC-ITEM-IMPORT — this built its own copy of the field rules, which is the copy
    // that mapped an empty category to `null` against a NOT NULL column while
    // `update` handled the same input correctly. `itemWriteData` is now the one
    // place, and it validates as it normalises: the limits, the length bounds, the
    // formula prefix and the reorder-threshold pair all come from
    // `normalizeItemRow`.
    const fields = this.itemWriteData(dto);

    const created = await this.prisma.item.create({
      data: {
        ...fields,
        publicId,
        // A new item joins the end of the catalog, in the order it was added.
        sortOrder: await this.nextSortOrder(),
        name: String(fields.name),
        // `codeGenerated` is what tells `generateMissingCodes` that this row is not
        // waiting for one. It must be set explicitly when a code was supplied and
        // left alone when none was, so a generated row is still a candidate.
        ...(dto.code?.trim() ? { codeGenerated: false } : {}),
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
    const existing = await this.prisma.item.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException(`Item not found: ${publicId}`);

    // Against the row as it will be, not against the fragment in this payload. A
    // partial update that raised one bound past the other used to be accepted, and
    // the stored pair was then inverted.
    this.assertLimitOrder(
      dto.minLimit ?? existing.minLimit ?? 0,
      dto.maxLimit ?? existing.maxLimit ?? 1000,
    );

    const updated = await this.prisma.item.update({
      where: { publicId },
      data: {
        ...this.itemWriteData(dto),
        // `codeGenerated` has to be cleared when the code is cleared. Setting the
        // code to an empty string writes NULL, and leaving the flag true produced a
        // row that claimed to carry a generated code while holding none — so
        // `generateMissingCodes` would skip it and nothing else would notice.
        codeGenerated: dto.code === undefined ? undefined : dto.code?.trim() ? false : dto.code !== undefined ? false : undefined,
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

    // Captured out of the transaction so the announcement after it can report what
    // actually changed, and so a rollback cannot leave a stale figure behind.
    let announcedCount = 0;

    const outcome = await this.prisma.$transaction(async (tx) => {
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

      announcedCount = moved || orderedPublicIds.length;

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

      return {
        success: true,
        ranked: orderedPublicIds.length,
        appended,
        moved,
        catalogSize: total,
      };
    });

    // FC-ITEM-IMPORT — announced after the transaction resolves, not inside it.
    //
    // It used to be the first statement before the `return` inside the callback,
    // between the two UPDATEs and the audit write. `emitSync` broadcasts
    // synchronously, so every connected client was told to refetch while the
    // transaction could still roll back — and on a rollback nothing corrected it.
    // The clients had already read the old order, announced the new one, and had
    // no second event to reconcile against. Transaction.service.ts:1019-1027
    // carries the rule with a comment explaining why it emits after the commit.
    this.emitItemsChanged('reordered', announcedCount);

    return outcome;
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
        select: { id: true, minLimit: true, maxLimit: true },
      });

      // FC-ITEM-IMPORT — the same rules the Excel import and the edit dialog apply,
      // applied here too. This path had no length bound, no formula guard and no
      // reorder-threshold check, and it is how the desktop client pushes a whole
      // catalogue, so all three were reachable from it. `existing` carries the
      // stored bounds because a half-present pair is validated against what will
      // actually be written, not against the fragment that arrived.
      const normalized = normalizeItemRow(item as unknown as Record<string, unknown>, {
        requireCategory: true,
      });
      const blocking = normalized.issues[0];
      if (blocking) {
        throw new BadRequestException(`${normalized.overlong.length ? describeOverlong(normalized.overlong[0]) : blocking.message}`);
      }
      this.assertLimitOrder(
        normalized.row.minLimit ?? existing?.minLimit ?? 0,
        normalized.row.maxLimit ?? existing?.maxLimit ?? 1000,
      );


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

    this.emitItemsChanged('synced', results.length);
    return { synced: results.length, total: items.length };
  }

  async findAll(params: FindAllItemsParams): Promise<PaginatedItemsResult> {
    const { skip = 0, take = 100, search, category, isArchived = false } = params;

    const where: any = {
      isArchived,
    };

    if (search) {
      // Barcode was not in this list before Wave 5, which made a barcode lookup — the
      // one search an operator performs with a scanner, at speed, in a warehouse —
      // go through a name-and-code substring search that a barcode almost never
      // matches, and miss every barcode with a leading zero.
      //
      // It is matched exactly rather than by `contains`, and that is the point. A
      // substring search on a barcode is actively wrong: code "123" would match
      // "12345" and "91234", so scanning a barcode that does not exist returns a
      // confident wrong item. Exact first, substring as the fallback for a
      // hand-typed fragment.
      where.OR = [
        { barcode: { equals: search, mode: 'insensitive' } },
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

    this.emitItemsChanged('archived', archived.count);
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

    this.emitItemsChanged('restored', restored.count);
    return { restored: restored.count, total: cleaned.length };
  }

  async deletePermanently(publicIds: string[], userId: string, actorUsername: string) {
    const cleaned = Array.from(new Set(publicIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!cleaned.length) return { deleted: 0, total: 0 };

    // Get items before deletion for audit
    const itemsToDelete = await this.prisma.item.findMany({
      where: { publicId: { in: cleaned } },
      select: { publicId: true, name: true, isArchived: true },
    });

    // FC-ITEM-IMPORT — permanent deletion is only a deliberate act, and only when
    // there is nothing left to lose.
    //
    // Archive first. The product already has a reversible path for removing an
    // item from the working catalogue, and reaching past it means the operator
    // skips the review that makes the action deliberate. The archived items
    // themselves are not in the requested set, so this reports the request as
    // refused rather than quietly archiving them.
    const activeTargets = itemsToDelete.filter((item) => !item.isArchived);
    if (activeTargets.length > 0) {
      throw new ConflictException({
        code: 'ITEM_NOT_ARCHIVED',
        message:
          'لا يمكن الحذف النهائي لصنف نشط. أرشفه أولاً، أو احذفه نهائياً بعد التأكد من أنه لا أثر له.',
        detail: {
          notArchived: activeTargets.map((item) => ({ publicId: item.publicId, name: item.name })),
        },
      });
    }

    // What the row would take with it. `Transaction.itemId` and
    // `OpeningBalance.itemId` are `onDelete: Cascade`, so deleting an item that
    // has movements silently deletes the ledger behind them — irreversibly, and
    // with no report. A reconciliation that then reads green over the hole is
    // worse than the delete being refused.
    const usage = await this.prisma.item.findMany({
      where: { publicId: { in: cleaned } },
      select: {
        publicId: true,
        _count: {
          select: {
            transactions: true,
            openingBalances: true,
            orderItems: true,
            stocktakingEntries: true,
            stockDeficits: true,
            formulaRows: true,
            targetFormulas: true,
          },
        },
      },
    });

    const blockers = usage
      .map((entry) => {
        const counts = entry._count as unknown as Record<string, number>;
        const present = Object.entries(counts)
          .filter(([, count]) => Number(count) > 0)
          .map(([relation, count]) => ({ relation, count: Number(count) }));
        return present.length ? { publicId: entry.publicId, present } : null;
      })
      .filter((entry): entry is { publicId: string; present: Array<{ relation: string; count: number }> } => entry !== null);

    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'ITEM_HAS_LEDGER',
        message:
          'لا يمكن الحذف النهائي لصنف له حركات أو رصيد أو طلبات. '
          + 'أرشفه بدلاً من ذلك، أو احذف الأرشيف بعد إغلاق الفترة.',
        detail: { blockers },
      });
    }

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

    this.emitItemsChanged('deleted', deleted.count);
    return { deleted: deleted.count, total: cleaned.length };
  }

  /**
   * FC-ITEM-IMPORT — one permanent-delete path, and it says what it destroys.
   *
   * This used to be a second copy of `deletePermanently` that took no actor, wrote
   * no audit row, and did not require the item to be archived first. Any
   * principal holding `items.delete` could therefore erase items permanently with
   * no trace — while the archive-first workflow that makes the action deliberate
   * could be skipped entirely.
   *
   * It now delegates rather than duplicating, so the guard below applies to both
   * routes and a future change to one cannot drift from the other.
   */
  async deleteByPublicIds(
    publicIds: string[],
    userId?: string,
    actorUsername?: string,
  ) {
    return this.deletePermanently(publicIds, String(userId || 'system'), String(actorUsername || 'system'));
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

    this.emitItemsChanged('codes.generated', generatedCodes.generated.length);

    return {
      success: generatedCodes.generated.length,
      total: missingItems.length,
      sample: generatedCodes.generated.slice(0, 5),
      prefix,
    };
  }

  // Phase 5: Bulk Import from Excel
  /**
   * The bulk importer.
   *
   * This used to be a loop of small transactions with a per-row retry. Four things
   * were wrong with that shape, and all four were the same bug wearing different
   * clothes: the import was not one thing, so nothing about it could be guaranteed.
   *
   *   - It was not atomic. Rows went in batches of fifty, and a batch that failed was
   *     retried one row at a time, so a duplicate on row seven still committed rows
   *     eight through fifty. A 500-row file could land half a catalogue and be
   *     reported as a partial success.
   *   - The audit row was outside the transaction and best-effort. Wave 1 stopped it
   *     from turning a committed import into a 500, but "best effort" is the same as
   *     "sometimes absent", and the guarantee everywhere else in this codebase is
   *     that a committed mutation always carries its audit row.
   *   - The rank base and the duplicate pre-check were both read before any lock. Two
   *     operators importing at once read the same `max(sortOrder)` and the same
   *     empty code list, so they produced interleaved ranks and duplicate codes. No
   *     constraint could catch either, because each was legal in isolation.
   *   - Nothing identified the run. The audit row named a generated `import-<uuid>`
   *     with no row behind it, so there was nothing to look at afterwards and no way
   *     to take it back.
   *
   * All four are fixed by making it one transaction under one lock and giving it a
   * row of its own. What was given up: partial success. A file whose rows partly
   * collide now imports nothing under `strict` rather than importing the survivors.
   * That is the point — partial success on a catalogue load is how a catalogue ends
   * up holding half a file twice.
   */
  async bulkImportFromExcel(
    items: ImportRowInput[],
    userId: string,
    actorUsername: string,
    options: {
      mode?: ImportMode;
      sourceFileName?: string;
      idempotencyKey?: string;
    } = {},
  ) {
    if (!Array.isArray(items)) {
      throw new BadRequestException('قائمة الأصناف مطلوبة.');
    }
    if (items.length > MAX_BULK_IMPORT_ROWS) {
      throw new BadRequestException(
        `الحد الأقصى للاستيراد هو ${MAX_BULK_IMPORT_ROWS} صف في العملية الواحدة.`,
      );
    }

    const mode: ImportMode = options.mode === 'strict' ? 'strict' : 'partial';
    const fileHash = fingerprintImportRows(items);
    const batchPublicId = `import-${randomUUID()}`;

    // The idempotency key is required, not optional. Without one a double-clicked
    // button is two imports, and the second is refused for duplicating the first's
    // codes — so the operator is shown an error for work that already succeeded.
    // `executeIdempotently` stores the key beside the result, so a retry replays the
    // first outcome instead of repeating it.
    let outcome;
    try {
      outcome = await executeIdempotently(
        this.prisma,
        userId || 'system',
        'items.import',
        options.idempotencyKey,
        { items, mode, fileHash },
        async (tx) => {
          // Everything below is one transaction, and the lock is the first thing in
          // it. Transaction-scoped on purpose: it releases on commit and on rollback
          // alike, so a failed import cannot leave the catalogue serialised.
          //
          // This is the first advisory lock in the codebase, and it is what makes
          // "read the catalogue, then act on it" mean anything. Without it the read
          // and the write are separated by a window another import can commit inside,
          // and the pre-check is a prediction rather than a fact.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mzs.items.import'))`;

          const existing = await this.readExistingImportKeys(tx, items);
          const plan = buildImportPlan(items, existing, { mode });

          // The batch row is created first so the items can point at it, and finished
          // last, in the same transaction. Nobody ever observes it half-built: the
          // intermediate state is inside a transaction that commits whole or not at
          // all. A rejected-only import commits a `failed` batch, and that is the row
          // the audit entry now names.
          const batch = await tx.itemImportBatch.create({
            data: {
              publicId: batchPublicId,
              sourceFileName: options.sourceFileName || null,
              fileHash,
              mode,
              status: 'running',
              totalRows: items.length,
              createdBy: userId || null,
              actorUsername: actorUsername || null,
              errors: plan.rejections as unknown as Prisma.InputJsonValue,
            },
          });

          // The rank base is read on the transaction, after the lock. Reading it
          // before was the race: `max + 1` is a correct answer to a question asked at
          // the wrong moment.
          const baseImportRank = await this.nextSortOrder(tx);

          // publicIds are generated up front so `createMany` can be used at all — it
          // takes no per-row hook. They are mapped back to names at the end because
          // `createMany` returns counts, not rows, and re-reading by id would be a
          // query to answer a question the caller just asked. Reading by batch is
          // better anyway: it is the same set the response describes.
          const prepared = plan.creates.map((row, index) => ({
            row,
            rank: baseImportRank + index,
            publicId: `item-${randomUUID()}`,
          }));

          for (let offset = 0; offset < prepared.length; offset += BULK_IMPORT_BATCH_SIZE) {
            const slice = prepared.slice(offset, offset + BULK_IMPORT_BATCH_SIZE);
            await tx.item.createMany({
              data: slice.map((entry) => ({
                publicId: entry.publicId,
                sortOrder: entry.rank,
                code: entry.row.code,
                codeGenerated: entry.row.code ? false : undefined,
                barcode: entry.row.barcode,
                name: entry.row.name,
                englishName: entry.row.englishName,
                unit: entry.row.unit,
                category: entry.row.category,
                minLimit: entry.row.minLimit,
                maxLimit: entry.row.maxLimit,
                orderLimit: entry.row.orderLimit,
                packageWeight: entry.row.packageWeight,
                description: entry.row.description,
                createdBy: userId || undefined,
                lastImportBatchId: batch.id,
              })),
            });
          }

          // The update branch. `sortOrder` is deliberately not written: an import that
          // re-ranked existing items would silently reorder a catalogue somebody
          // arranged by hand, and rank belongs to the order profile, not to a
          // spreadsheet.
          const updated: Array<{ row: number; publicId: string; name: string; status: string }> = [];
          for (const row of plan.updates) {
            const saved = await tx.item.update({
              where: { publicId: row.targetPublicId },
              data: {
                name: row.name,
                code: row.code,
                barcode: row.barcode,
                englishName: row.englishName,
                unit: row.unit,
                category: row.category,
                minLimit: row.minLimit,
                maxLimit: row.maxLimit,
                orderLimit: row.orderLimit,
                packageWeight: row.packageWeight,
                description: row.description,
                // Clear the archive flag when the row was archived. Without this the
                // update is written to something that stays filtered out of every
                // list, and the operator's import lands with nothing visibly changed.
                ...(row.reactivate
                  ? {
                      isArchived: false,
                      archivedAt: null,
                      archivedBy: null,
                    }
                  : {}),
                updatedBy: userId || undefined,
                lastImportBatchId: batch.id,
              },
            });
            updated.push({
              row: row.rowNumber,
              publicId: String(saved.publicId),
              name: saved.name,
              status: row.reactivate ? 'reactivated' : 'updated',
            });
          }


          // Nothing is read back. `createMany` returns counts rather than rows, and
          // the publicIds are already known because they were generated here — so the
          // set of landed items is the set of prepared ones, with no query to confirm
          // what the transaction already knows.

          await tx.itemImportBatch.update({

            where: { id: batch.id },
            data: {
              status: plan.rejectionCount > 0 ? 'partial' : 'succeeded',
              createdCount: plan.creates.length,
              updatedCount: plan.updates.length,
              failedCount: plan.rejectionCount,
              finishedAt: new Date(),
              durationMs: Date.now() - batch.startedAt.getTime(),
            },
          });

          if (plan.rejectionCount > 0) {
            await tx.itemImportError.createMany({
              data: plan.rejections.map((entry) => ({
                batchId: batch.id,
                rowNumber: entry.row,
                field: entry.field,
                message: entry.message,
                value:
                  entry.value === undefined || entry.value === null ? null : String(entry.value),
              })),
            });
          }

          const results = [
            ...prepared.map((entry) => ({
              row: entry.row.rowNumber,
              publicId: entry.publicId,
              name: entry.row.name,
              status: 'created',
            })),
            ...updated,
          ];

          return {

            batchId: batchPublicId,
            mode,
            status: plan.rejectionCount > 0 ? 'partial' : 'succeeded',
            success: prepared.length + updated.length,
            failed: plan.rejectionCount,
            total: items.length,
            created: prepared.length,
            updated: updated.length,
            results,
            errors: plan.rejections.map((entry) => ({
              row: entry.row,
              field: entry.field,
              message: entry.message,
              // `error` duplicates `message` and the response type declares it
              // required. It is read by name in the studio and in the tests, so it
              // stays. Two spellings of one string is a known smell, not a secret.
              error: entry.message,
              value: entry.value,
            })),
          };
        },
        // Inside the transaction, not after it. A committed import without its audit
        // row used to be possible, and the reason was that the audit write lived past
        // the transaction boundary where it could no longer join it.
        async (tx, result) => {
          await tx.auditLog.create({
            data: buildAuditRow({
              actorId: userId || 'system',
              actorUsername: actorUsername || 'system',
              actorRole: 'unknown',
              action: 'IMPORT',
              targetResource: 'item',
              entityType: 'Item',
              entityId: result.batchId,
              // A file where nothing landed is a failure, not a success that happened
              // to create nothing.
              status: result.success > 0 ? 'success' : 'failed',

              message: `import ${result.batchId}: ${result.created} created, ${result.updated} updated, ${result.failed} rejected of ${result.total}`,
              metadata: {
                batchId: result.batchId,
                mode: result.mode,
                created: result.created,
                updated: result.updated,
                failed: result.failed,
                total: result.total,
              },
            }),
          });
        },
      );
    } catch (error: any) {
      // A unique violation that survives the pre-check means the catalogue changed
      // under the lock — which should not happen, and saying so plainly is more use
      // than a raw P2002. The transaction rolled back, so nothing landed and there is
      // no batch row: the record of a failed import that died before its own table
      // was written cannot be written by the transaction that died. That gap is
      // stated rather than papered over.
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'تعارض في الكود أو الباركود مع صنف آخر. أعد التحقق من الملف قبل الاستيراد.',
        );
      }
      throw error;
    }

    // After the commit, and never able to fail the request. A realtime broadcast that
    // throws must not turn a committed catalogue into a 500, for the same reason the
    // audit row belongs inside the transaction: once the work is durable, the answer
    // to the caller is that it succeeded.
    if (outcome.value.success > 0) {
      this.emitItemsChanged('imported', outcome.value.success, {
        batchId: outcome.value.batchId,
      });
    }

    return {
      success: outcome.value.success,
      failed: outcome.value.failed,
      total: outcome.value.total,
      // The split, not just the sum. "12 succeeded" is a fact the operator can read and
      // not act on; "9 created, 3 updated" is the difference between a load and a
      // correction, and the studio's outcome report needs it to label each row.
      created: outcome.value.created,
      updated: outcome.value.updated,
      batchId: outcome.value.batchId,
      status: outcome.value.status,
      replayed: outcome.replayed,
      results: outcome.value.results,
      errors: outcome.value.errors,
    };
  }


  /**
   * The dry run. Same decision, no write.
   *
   * The point of this endpoint is that its answer is the answer `import-excel` will
   * give, so both call `buildImportPlan` on the same inputs. What differs is that
   * this one does not take the lock and does not write: it reads the catalogue as it
   * is now, which is what an operator wants before deciding, and it is honest that a
   * real import may see a different catalogue by the time it runs.
   */
  async validateImport(items: ImportRowInput[], options: { mode?: ImportMode } = {}) {
    if (!Array.isArray(items)) {
      throw new BadRequestException('قائمة الأصناف مطلوبة.');
    }
    if (items.length > MAX_BULK_IMPORT_ROWS) {
      throw new BadRequestException(
        `الحد الأقصى للتحقق هو ${MAX_BULK_IMPORT_ROWS} صف في العملية الواحدة.`,
      );
    }
    const mode: ImportMode = options.mode === 'strict' ? 'strict' : 'partial';
    const existing = await this.readExistingImportKeys(this.prisma, items);
    const plan = buildImportPlan(items, existing, { mode });
    return {
      valid: plan.rejectionCount === 0,
      mode,
      modeDescription: describeImportMode(mode),
      wouldCreate: plan.creates.length,
      wouldUpdate: plan.updates.length,
      rejected: plan.rejectionCount,
      total: plan.total,
      /**
       * Rows whose code or barcode already belongs to an *archived* item.
       *
       * Surfaced here rather than buried in the studio because it is the one case where
       * the operator has a real decision to make and no way to discover the option: the
       * row imports either way, but whether the archived item comes back into the
       * catalogue is theirs to choose. Naming it before they press the button is the
       * difference between a choice and a surprise.
       */
      archivedMatches: plan.creates
        .filter((row) => row.archivedMatch)
        .map((row) => ({
          row: row.rowNumber,
          name: row.name,
          archivedPublicId: row.archivedMatch!.publicId,
          archivedName: row.archivedMatch!.name,
        })),
      errors: plan.rejections,
    };
  }


  /**
   * Reads only the catalogue columns a plan needs, on whichever client the caller
   * holds — the transaction that will act on the answer, or the plain client for a
   * dry run.
   *
   * The query folds the same way the unique index folds. Not an optimisation: `IN` on
   * text compares exactly, `Item_code_key` is case-sensitive, and `P2002` never fired
   * for `ABC` against `abc`. A pre-check has to use the index's expression or it is
   * predicting a constraint it never reads.
   */
  private async readExistingImportKeys(
    client: PrismaService | Prisma.TransactionClient,
    items: readonly ImportRowInput[],
  ): Promise<ExistingKey[]> {
    const codes = [
      ...new Set(items.map((item) => foldImportKey(item.code)).filter(Boolean)),
    ];
    const barcodes = [
      ...new Set(items.map((item) => foldImportKey(item.barcode)).filter(Boolean)),
    ];
    if (codes.length === 0 && barcodes.length === 0) return [];

    const conditions: Prisma.Sql[] = [];
    if (codes.length) {
      conditions.push(Prisma.sql`lower(btrim(item."code")) = ANY(${codes}::text[])`);
    }
    if (barcodes.length) {
      conditions.push(Prisma.sql`lower(btrim(item."barcode")) = ANY(${barcodes}::text[])`);
    }

    return client.$queryRaw<ExistingKey[]>(Prisma.sql`
      SELECT item."publicId"    AS "publicId",
             item."code"        AS "code",
             item."barcode"     AS "barcode",
             item."name"        AS "name",
             item."isArchived"  AS "isArchived"
        FROM "public"."Item" AS item
       WHERE ${Prisma.join(conditions, ' OR ')}
    `);
  }

  /**
   * Takes one import back.
   *
   * It archives, and it says no a lot.
   *
   * The reason for all the refusals is in the foreign keys, and it was worth checking
   * rather than assuming: `Transaction.itemId`, `OpeningBalance.itemId` and
   * `ItemOrderEntry.itemId` are all `ON DELETE CASCADE`. A hard delete of an item
   * that has ever moved is not a delete — it is a cascade that removes the ledger row
   * with it, silently, inside the database, with no application code involved and
   * nothing to see in the audit trail afterwards. The existing
   * `delete-permanent` endpoint sits on exactly that. This one does not share the
   * hazard, because it refuses rather than cascading.
   *
   * So: an item with history is not reverted, it is reported. The operator gets the
   * list of what is holding each row and decides. A revert that could quietly destroy
   * a year of movements is not a revert.
   *
   * Archive rather than delete, for the same reason: the item disappears from the
   * catalogue but its identity, and the fact that an import created it, both survive.
   * `purge` exists for the case where an import demonstrably created a row that never
   * touched anything, and it is only reachable when every single count below is zero.
   */
  async revertImportBatch(
    batchPublicId: string,
    actor: { userId?: string; username?: string },
    options: { purge?: boolean; idempotencyKey?: string } = {},
  ) {

    const batch = await this.prisma.itemImportBatch.findUnique({
      where: { publicId: batchPublicId },
    });
    if (!batch) {
      throw new NotFoundException(`دفعة الاستيراد غير موجودة: ${batchPublicId}`);
    }
    if (batch.status === 'reverted') {
      throw new ConflictException('سبق التراجع عن هذه الدفعة.');
    }

    // One query for every blocker, per item.
    //
    // Eight separate counts would be eight round trips to answer one question, and
    // the answer has to be a single consistent snapshot: counting in one statement is
    // what stops "no movements" and "one movement" being true at different moments
    // of the same request. The LEFT JOINs keep items with no references in the
    // result rather than dropping them, because "nothing is in the way" is the case
    // that most needs to be reported.
    const blockers = await this.prisma.$queryRaw<
      Array<{
        publicId: string;
        name: string;
        /**
         * Read, never written. The revert's whole job is to notice a non-zero balance
         * and refuse, so it has to look at the column; it must never assign it. The
         * `stock-write-boundary` guard distinguishes the two by this declaration being
         * a type annotation on a read shape rather than a key in a write payload.
         */
        currentStock: unknown;

        transactions: bigint;
        openingBalances: bigint;
        orderLines: bigint;
        stocktakings: bigint;
        deficits: bigint;
        formulationLines: bigint;
        formulationTargets: bigint;
        orderEntries: bigint;
      }>
    >(Prisma.sql`
      SELECT item."publicId"                              AS "publicId",
             item."name"                                  AS "name",
             item."currentStock"                          AS "currentStock",
             COALESCE(tx."count", 0)                     AS "transactions",
             COALESCE(ob."count", 0)                      AS "openingBalances",
             COALESCE(oi."count", 0)                      AS "orderLines",
             COALESCE(st."count", 0)                      AS "stocktakings",
             COALESCE(sd."count", 0)                      AS "deficits",
             COALESCE(fi."count", 0)                      AS "formulationLines",
             COALESCE(ft."count", 0)                      AS "formulationTargets",
             COALESCE(oe."count", 0)                      AS "orderEntries"
        FROM "public"."Item" AS item
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."Transaction" GROUP BY "itemId") AS tx
               ON tx."itemId" = item."id"
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."OpeningBalance" GROUP BY "itemId") AS ob
               ON ob."itemId" = item."id"
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."order_items" GROUP BY "itemId") AS oi
               ON oi."itemId" = item."id"
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."stocktaking_entries" GROUP BY "itemId") AS st
               ON st."itemId" = item."id"
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."StockDeficit" GROUP BY "itemId") AS sd
               ON sd."itemId" = item."id"
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."formulation_items" GROUP BY "itemId") AS fi
               ON fi."itemId" = item."id"
        LEFT JOIN (SELECT "targetItemId" AS "itemId", count(*) AS "count" FROM "public"."formulations" GROUP BY "targetItemId") AS ft
               ON ft."itemId" = item."id"
        LEFT JOIN (SELECT "itemId", count(*) AS "count" FROM "public"."ItemOrderEntry" GROUP BY "itemId") AS oe
               ON oe."itemId" = item."id"
       WHERE item."lastImportBatchId" = ${batch.id}::uuid
       ORDER BY item."sortOrder" ASC
    `);

    // Named in the order an operator meets them, and each name is the thing itself
    // rather than a table name. "الحركات" is something a person recognises; "Transaction"
    // is a word they have to go and look up before they can decide.
    const describeBlockers = (row: typeof blockers[number]): string[] => {
      const reasons: string[] = [];
      const stock = Number(row.currentStock ?? 0);
      if (Number(row.transactions) > 0) reasons.push(`حركات مسجّلة (${row.transactions})`);
      if (Number(row.openingBalances) > 0) reasons.push(`رصيد افتتاحي مقفل (${row.openingBalances})`);
      if (Number(row.orderLines) > 0) reasons.push(`سطر طلب (${row.orderLines})`);
      if (Number(row.stocktakings) > 0) reasons.push(`جرد مخزون (${row.stocktakings})`);
      if (Number(row.deficits) > 0) reasons.push(`عجز مخزون (${row.deficits})`);
      if (Number(row.formulationLines) > 0) reasons.push(`سطر تركيبة (${row.formulationLines})`);
      if (Number(row.formulationTargets) > 0) reasons.push(`مادة ناتج تركيبة (${row.formulationTargets})`);
      if (stock !== 0) reasons.push(`رصيد حالي غير صفري (${stock})`);
      return reasons;
    };

    const blocked = blockers
      .map((row) => ({ publicId: row.publicId, name: row.name, reasons: describeBlockers(row) }))
      .filter((row) => row.reasons.length > 0);

    // The refusal is the feature. This is the check the original `delete-permanent`
    // never made, and it is why this endpoint exists next to it.
    if (blocked.length > 0) {
      throw new ConflictException({
        message: `لا يمكن التراجع: ${blocked.length} من أصل ${blockers.length} صنفاً تحرّك منذ الاستيراد.`,
        blockers: blocked.slice(0, 100),
        blockedCount: blocked.length,
        totalCount: blockers.length,
        batchId: batchPublicId,
      });
    }

    const publicIds = blockers.map((row) => row.publicId);
    // Required, like the import's. A revert is the one operation here that takes
    // rows *out* of the catalogue, so a repeated request is more damaging than a
    // repeated import: without a key, a double-clicked "تراجع" is two reverts, and
    // the second one refuses with "already reverted" — which reads as a failure for
    // work that already succeeded. `purge` makes it a delete, and a repeated delete
    // has nothing left to report at all.
    if (!options.idempotencyKey) {
      throw new BadRequestException(
        'يلزم ترويسة Idempotency-Key للتراجع عن دفعة استيراد.',
      );
    }
    const outcome = await executeIdempotently(
      this.prisma,
      actor.userId || 'system',
      'items.import.revert',
      options.idempotencyKey,
      { batchPublicId, purge: Boolean(options.purge), ids: publicIds },

      async (tx) => {
        if (options.purge) {
          // Reachable only because every count above was zero. The delete is
          // `deleteMany` on an explicit id list, not a cascade nobody can see.
          const deleted = await tx.item.deleteMany({ where: { publicId: { in: publicIds } } });
          return { deleted: deleted.count, archived: 0, purged: true };
        }
        const archived = await tx.item.updateMany({
          where: { publicId: { in: publicIds } },
          data: { isArchived: true, updatedBy: actor.userId || undefined },
        });
        return { deleted: 0, archived: archived.count, purged: false };
      },
      async (tx, result) => {
        await tx.itemImportBatch.update({
          where: { id: batch.id },
          data: { status: 'reverted', finishedAt: new Date() },
        });
        await tx.auditLog.create({
          data: buildAuditRow({
            actorId: actor.userId || 'system',
            actorUsername: actor.username || 'system',
            actorRole: 'unknown',
            action: 'IMPORT_REVERT',
            targetResource: 'item',
            entityType: 'Item',
            entityId: batchPublicId,
            status: 'success',
            message: `revert ${batchPublicId}: ${result.archived} archived, ${result.deleted} deleted`,
            metadata: {
              batchId: batchPublicId,
              archived: result.archived,
              deleted: result.deleted,
              purged: result.purged,
            },
          }),
        });
      },
    );

    if (outcome.value.archived > 0) {
      this.emitItemsChanged('reverted', outcome.value.archived, { batchId: batchPublicId });
    }

    return {
      batchId: batchPublicId,
      status: 'reverted',
      archived: outcome.value.archived,
      deleted: outcome.value.deleted,
      purged: outcome.value.purged,
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
