import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { executeIdempotently } from '../common/idempotency';
import { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto';

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async list() {
    const rows = await this.prisma.partner.findMany({ orderBy: { name: 'asc' } });
    return rows;
  }

  async create(dto: CreatePartnerDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const execution = await executeIdempotently(
      this.prisma,
      actorId,
      'partners.create',
      idempotencyKey,
      dto,
      (tx) => tx.partner.create({
        data: {
          name: dto.name.trim(),
          type: dto.type,
          phone: dto.phone.trim(),
          address: dto.address?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: actorId,
        },
      }),
    );
    if (!execution.replayed) {
      this.realtimeService.emitSync(['partners', 'orders', 'operations'], 'partners.created', { meta: { id: execution.value.id } });
      await this.auditService.logItemAction(actorId, 'CREATE', 'Partner', execution.value.id, { name: execution.value.name }, actorUsername);
    }
    return execution.value;
  }

  async update(id: string, dto: UpdatePartnerDto, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const execution = await executeIdempotently(
      this.prisma,
      actorId,
      'partners.update',
      idempotencyKey,
      { id, dto },
      async (tx) => {
        const existing = await tx.partner.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException(`Partner not found: ${id}`);
        return tx.partner.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
            type: dto.type,
            phone: dto.phone?.trim(),
            address: dto.address?.trim(),
            notes: dto.notes?.trim(),
          },
        });
      },
    );
    if (!execution.replayed) {
      this.realtimeService.emitSync(['partners', 'orders', 'operations'], 'partners.updated', { meta: { id } });
      await this.auditService.logItemAction(actorId, 'UPDATE', 'Partner', id, { name: execution.value.name }, actorUsername);
    }
    return execution.value;
  }

  async remove(id: string, actorId = 'system', actorUsername = 'system', idempotencyKey?: string) {
    const execution = await executeIdempotently(
      this.prisma,
      actorId,
      'partners.delete',
      idempotencyKey,
      { id },
      async (tx) => {
        const existing = await tx.partner.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
        if (!existing) throw new NotFoundException(`Partner not found: ${id}`);
        if (existing._count.orders > 0) throw new ConflictException('Partner cannot be deleted while orders reference it');
        return tx.partner.delete({ where: { id } });
      },
    );
    if (!execution.replayed) {
      this.realtimeService.emitSync(['partners', 'orders'], 'partners.deleted', { meta: { id } });
      await this.auditService.logItemAction(actorId, 'DELETE', 'Partner', id, {}, actorUsername);
    }
    return { deleted: 1 };
  }
}
