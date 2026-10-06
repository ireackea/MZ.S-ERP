import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { buildAuditRow } from '../audit/audit-row';
import { RealtimeService } from '../realtime/realtime.service';

export type OrderProfileActor = {
  userId?: string;
  username?: string;
  role?: string;
  ipAddress?: string;
};

export type OrderProfileSummary = {
  id: string;
  name: string;
  isActive: boolean;
  itemCount: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * How far the working order has moved away from this saved order.
   *
   * `unlisted` counts items the profile says nothing about — usually items added
   * or imported since it was written. `moved` counts items it places somewhere
   * other than where the catalogue currently has them. Both are reported so the
   * interface can say "this order is behind" instead of quietly applying an
   * arrangement that no longer covers the catalogue.
   */
  drift: { unlisted: number; moved: number };
};

/**
 * Named, saved catalogue orders.
 *
 * `Item.sortOrder` holds one order. That was enough until somebody wanted a
 * second arrangement, at which point the first could only be overwritten and
 * never recovered. A profile is a saved arrangement under a name the operator
 * chose; the active one is materialised into `Item.sortOrder`, which is what every
 * read path already orders by.
 *
 * The division of responsibility matters and is easy to get wrong:
 *
 * - **The saved profile is the truth.** It only changes when somebody asks.
 * - **`Item.sortOrder` is the materialised copy**, there so the catalogue can be
 *   read with one indexed `orderBy` from six different services. It is rewritten
 *   on apply, on refresh and on a full reorder, and nothing else.
 *
 * So an operator can move things on screen freely — the catalogue visibly changes,
 * because the working order is `Item.sortOrder` — and nothing is *saved* until
 * they refresh the profile or save under a new name. That is the behaviour that
 * was asked for: the arrows are allowed, and nothing is kept except by an
 * explicit act.
 */
@Injectable()
export class ItemOrderProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /**
   * Every saved order, newest first, with the active one marked and each one's
   * drift from the working order.
   */
  async list(actor: OrderProfileActor): Promise<{
    activeProfileId: string | null;
    catalogSize: number;
    profiles: OrderProfileSummary[];
  }> {
    const [profiles, items] = await Promise.all([
      this.prisma.itemOrderProfile.findMany({
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        include: { entries: { select: { itemId: true, rank: true } } },
      }),
      this.prisma.item.findMany({ select: { id: true, sortOrder: true } }),
    ]);

    const live = new Map(items.map((item) => [item.id, item.sortOrder]));
    const catalogSize = items.length;

    return {
      activeProfileId: profiles.find((profile) => profile.isActive)?.id ?? null,
      catalogSize,
      profiles: profiles.map((profile) => {
        const byId = new Map(profile.entries.map((entry) => [entry.itemId, entry.rank]));
        let unlisted = 0;
        let moved = 0;

        for (const [itemId, sortOrder] of live) {
          const rank = byId.get(itemId);
          if (rank === undefined) {
            unlisted += 1;
          } else if (sortOrder !== rank) {
            moved += 1;
          }
        }

        return {
          id: profile.id,
          name: profile.name,
          isActive: profile.isActive,
          itemCount: profile.itemCount,
          note: profile.note,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
          drift: { unlisted, moved },
        };
      }),
    };
  }

  /**
   * Saves the working order under a name and makes it the active one.
   *
   * The starting state for a named order is what is on screen now, which is the
   * whole reason this is worth having: the arrangement somebody just built, or the
   * order a spreadsheet import produced, gets a name and becomes something they
   * can come back to.
   */
  async create(
    input: { name: string; note?: string | null },
    actor: OrderProfileActor,
  ): Promise<{ id: string; name: string; itemCount: number; isActive: true }> {
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('اسم الترتيب مطلوب.');
    if (name.length > 120) {
      throw new BadRequestException('اسم الترتيب أطول من الحد المسموح (120 حرفًا).');
    }

    return this.prisma.$transaction(async (tx) => {
      const clash = await tx.itemOrderProfile.findUnique({ where: { name } });
      if (clash) {
        throw new ConflictException({
          code: 'ITEM_ORDER_PROFILE_NAME_TAKEN',
          message: `يوجد ترتيب محفوظ باسم "${name}" بالفعل. اختر اسمًا آخر.`,
          detail: { name },
        });
      }

      const items = await tx.item.findMany({
        orderBy: [{ sortOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        select: { id: true },
      });
      if (items.length === 0) {
        throw new BadRequestException('لا توجد أصناف لحفظ ترتيبها.');
      }

      const profile = await this.writeProfile(tx, {
        name,
        note: input.note ?? null,
        items: items.map((item) => item.id),
        makeActive: true,
        actor,
      });

      await this.audit(tx, actor, 'ITEM_ORDER_PROFILE_SAVED', profile.name, items.length, profile.id);
      return {
        id: profile.id,
        name: profile.name,
        itemCount: items.length,
        isActive: true as const,
      };
    });
  }

  /**
   * Makes a saved order the live one.
   *
   * Items the profile does not mention keep their current relative order and go
   * after the ones it does — the same rule the full reorder uses, so a profile
   * written before some items existed still applies cleanly instead of dropping
   * them to the end of the alphabet.
   */
  async apply(profileId: string, actor: OrderProfileActor): Promise<{ id: string; name: string; ranked: number; appended: number }> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await this.requireProfile(tx, profileId);
      const entries = await tx.itemOrderEntry.findMany({
        where: { profileId },
        orderBy: { rank: 'asc' },
        select: { itemId: true },
      });
      if (entries.length === 0) {
        throw new BadRequestException(`الترتيب المحفوظ "${profile.name}" فارغ.`);
      }

      const { ranked, appended } = await this.materialise(tx, entries.map((entry) => entry.itemId));

      await this.setActive(tx, profileId, actor);
      await this.audit(tx, actor, 'ITEM_ORDER_PROFILE_APPLIED', profile.name, ranked, profileId, { appended });

      return { id: profile.id, name: profile.name, ranked, appended };
    }).then((result) => {
      // FC-ITEM-IMPORT — announced after the commit, because this is the change the
      // other sessions most need to hear about and the one they were never told
      // about. `materialise` rewrites `Item.sortOrder` for the whole catalogue —
      // the exact column every list endpoint orders by — and the service has
      // injected RealtimeService since it was written without ever calling it, so
      // after applying a saved order no other session learned the catalogue had
      // been rearranged. It kept the stale order until its next manual load.
      this.announceReorder(`applied:${profileId}`, result.ranked);
      return result;
    });
  }

  /**
   * Writes the working order into a saved order — the button that makes a manual
   * rearrangement stick, and the way items added since the order was written join
   * it.
   */
  async refresh(profileId: string, actor: OrderProfileActor): Promise<{ id: string; name: string; itemCount: number }> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await this.requireProfile(tx, profileId);

      const items = await tx.item.findMany({
        orderBy: [{ sortOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        select: { id: true },
      });
      if (items.length === 0) {
        throw new BadRequestException('لا توجد أصناف لحفظ ترتيبها.');
      }

      const written = await this.writeProfile(tx, {
        name: profile.name,
        note: profile.note,
        items: items.map((item) => item.id),
        makeActive: true,
        actor,
        existingId: profileId,
      });

      await this.audit(tx, actor, 'ITEM_ORDER_PROFILE_REFRESHED', profile.name, items.length, profileId);
      return { id: written.id, name: written.name, itemCount: items.length };
    }).then((result) => {
      // Same reasoning as `apply`: refreshing a saved order re-ranks the catalogue
      // through `writeProfile`'s materialise, so other sessions are looking at an
      // order that no longer exists until they reload.
      this.announceReorder(`refreshed:${profileId}`, result.itemCount);
      return result;
    });
  }

  async rename(profileId: string, name: string, actor: OrderProfileActor): Promise<{ id: string; name: string }> {
    const next = String(name || '').trim();
    if (!next) throw new BadRequestException('اسم الترتيب مطلوب.');

    return this.prisma.$transaction(async (tx) => {
      await this.requireProfile(tx, profileId);
      const clash = await tx.itemOrderProfile.findUnique({ where: { name: next } });
      if (clash && clash.id !== profileId) {
        throw new ConflictException({
          code: 'ITEM_ORDER_PROFILE_NAME_TAKEN',
          message: `يوجد ترتيب محفوظ باسم "${next}" بالفعل. اختر اسمًا آخر.`,
          detail: { name: next },
        });
      }
      const updated = await tx.itemOrderProfile.update({
        where: { id: profileId },
        data: { name: next, updatedBy: actor.userId ?? null },
      });
      await this.audit(tx, actor, 'ITEM_ORDER_PROFILE_RENAMED', next, 0, profileId);
      return { id: updated.id, name: updated.name };
    });
  }

  /**
   * Deletes a saved order.
   *
   * The active one is refused rather than deleted, because deleting it would leave
   * the catalogue showing an order that nothing remembers. That is a trap the
   * operator cannot see coming, so the button offers a different action instead.
   */
  async remove(profileId: string, actor: OrderProfileActor): Promise<{ id: string; deleted: true }> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await this.requireProfile(tx, profileId);
      if (profile.isActive) {
        throw new ConflictException({
          code: 'ITEM_ORDER_PROFILE_ACTIVE',
          message:
            `لا يمكن حذف الترتيب "${profile.name}" لأنه المُفعَّل الآن. ` +
            'فعّل ترتيبًا آخر أولًا ثم احذف هذا.',
          detail: { id: profileId, name: profile.name },
        });
      }
      // Entries go with it by cascade; the constraint is declared on the relation.
      await tx.itemOrderProfile.delete({ where: { id: profileId } });
      await this.audit(tx, actor, 'ITEM_ORDER_PROFILE_DELETED', profile.name, 0, profileId);
      return { id: profileId, deleted: true as const };
    });
  }

  /** The active profile, or null when none has been created yet. */
  async active() {
    return this.prisma.itemOrderProfile.findFirst({ where: { isActive: true } });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async requireProfile(tx: Prisma.TransactionClient, profileId: string) {
    const profile = await tx.itemOrderProfile.findUnique({ where: { id: profileId } });
    if (!profile) {
      throw new NotFoundException(`الترتيب المحفوظ غير موجود: ${profileId}`);
    }
    return profile;
  }

  /**
   * Writes a profile and, when it becomes active, materialises it.
   *
   * Both halves are in one transaction on purpose. A profile that is marked active
   * while `Item.sortOrder` still holds the previous order is a catalogue whose
   * two records of the truth disagree, and the read paths follow the column.
   */
  private async writeProfile(
    tx: Prisma.TransactionClient,
    input: {
      name: string;
      note?: string | null;
      items: number[];
      makeActive: boolean;
      actor: OrderProfileActor;
      existingId?: string;
    },
  ) {
    if (input.existingId) {
      await tx.itemOrderEntry.deleteMany({ where: { profileId: input.existingId } });
    }
    if (input.makeActive) {
      await tx.itemOrderProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }

    const profile = input.existingId
      ? await tx.itemOrderProfile.update({
          where: { id: input.existingId },
          data: {
            note: input.note ?? null,
            itemCount: input.items.length,
            isActive: input.makeActive,
            updatedBy: input.actor.userId ?? null,
          },
        })
      : await tx.itemOrderProfile.create({
          data: {
            name: input.name,
            note: input.note ?? null,
            itemCount: input.items.length,
            isActive: input.makeActive,
            createdBy: input.actor.userId ?? null,
            updatedBy: input.actor.userId ?? null,
          },
        });

    if (input.items.length > 0) {
      await tx.itemOrderEntry.createMany({
        data: input.items.map((itemId, rank) => ({ profileId: profile.id, itemId, rank })),
      });
    }

    if (input.makeActive) {
      await this.materialise(tx, input.items);
    }

    return profile;
  }

  /**
   * Writes a list of item ids into `Item.sortOrder`.
   *
   * The listed items are numbered from zero. Items not listed keep their current
   * relative order and follow, so a profile written before some items existed
   * still applies without dropping those items or re-alphabetising the tail.
   */
  /**
   * Announce a catalogue reorder without ever failing the request that caused it.
   *
   * `emitSync` is synchronous and unguarded (realtime.service.ts:39-50), so a
   * throw would answer 500 for a transaction that had already committed. The same
   * guard, with the same reasoning, is in `ItemService.emitItemsChanged`; the two
   * live in separate services and neither can call the other without a circular
   * dependency, so the shape is repeated deliberately and named the same way.
   *
   * The event is `items.reordered` rather than something profile-specific, because
   * that is the event every client already knows how to handle — it is what
   * `POST /items/reorder` sends, and `App.tsx` refreshes the catalogue on it.
   */
  private announceReorder(suffix: string, count: number) {
    if (count <= 0) return;
    try {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.reordered',
        { meta: { count, source: `order-profile:${suffix}` } },
      );
    } catch (error) {
      console.error(
        `[item-order-profile] committed a reorder but the realtime announcement failed (${suffix}, count=${count}):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async materialise(tx: Prisma.TransactionClient, itemIds: number[]) {
    // Both columns are cast explicitly. A VALUES list built from parameters has no
    // type of its own, and Postgres resolves the first unknown column to `text` —
    // so `item."id" = ranked."id"` came back as `operator does not exist:
    // integer = text` and the whole save failed with a 500.
    const ranked = itemIds.map((id, rank) => Prisma.sql`(${id}::int, ${rank}::int)`);

    await tx.$executeRaw`
      UPDATE "public"."Item" AS item
      SET "sortOrder" = ranked.rank
      FROM (VALUES ${Prisma.join(ranked)}) AS ranked("id", rank)
      WHERE item."id" = ranked."id"
    `;

    // The exclusion list is built as an explicit `IN (...)` rather than
    // `= ANY(${array}::int[])`.
    //
    // Prisma binds a JavaScript array parameter as a single text value, so the
    // `::int[]` cast applies to that text rather than to the elements, and Postgres
    // answers `operator does not exist: integer = text`. An explicit list casts
    // each element, so the statement is correct regardless of how the driver
    // serialises the parameter.
    const excluded =
      itemIds.length > 0
        ? Prisma.sql`AND "Item"."id" NOT IN (${Prisma.join(
            itemIds.map((id) => Prisma.sql`${id}::int`),
          )})`
        : Prisma.sql``;

    const appended = await tx.$executeRaw`
      WITH rest AS (
        SELECT "Item"."id",
               ${BigInt(itemIds.length)}
                 + ROW_NUMBER() OVER (ORDER BY "Item"."sortOrder" ASC NULLS LAST, "Item"."name" ASC, "Item"."id" ASC)
                 - 1 AS rank
        FROM "public"."Item"
        WHERE TRUE ${excluded}
      )
      UPDATE "public"."Item" AS item
      SET "sortOrder" = rest.rank
      FROM rest
      WHERE item."id" = rest."id"
    `;

    return { ranked: itemIds.length, appended };
  }

  /**
   * Exactly one active profile.
   *
   * The database also enforces this with a partial unique index, and that is the
   * real guarantee — two operators clicking "apply" at the same moment can
   * interleave between this read and this write. The index is what makes the
   * outcome impossible rather than unlikely; this code keeps the intent readable
   * and the common case correct.
   */
  private async setActive(tx: Prisma.TransactionClient, profileId: string, actor: OrderProfileActor) {
    await tx.itemOrderProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
    await tx.itemOrderProfile.update({
      where: { id: profileId },
      data: { isActive: true, updatedBy: actor.userId ?? null },
    });
  }

  /**
   * The record of what was done to a saved order.
   *
   * Written on the transaction client, so an order and the fact that it changed
   * commit together. The reset learned this the hard way: a row written on a
   * second connection survives the rollback of the work it describes, which leaves
   * the log describing something the database never did.
   */
  private audit(
    tx: Prisma.TransactionClient,
    actor: OrderProfileActor,
    action: string,
    profileName: string,
    itemCount: number,
    profileId: string,
    extra: Record<string, unknown> = {},
  ) {
    return tx.auditLog.create({
      data: buildAuditRow({
        actorId: actor.userId ?? 'system',
        actorUsername: actor.username ?? 'system',
        actorRole: actor.role ?? 'unknown',
        action,
        targetResource: 'item_order_profile',
        entityType: 'ItemOrderProfile',
        entityId: profileId,
        status: 'success',
        message: `${action} on "${profileName}" (${itemCount} items)`,
        metadata: { profileId, profileName, itemCount, ...extra },
        ipAddress: actor.ipAddress || undefined,
      }),
    });
  }
}
