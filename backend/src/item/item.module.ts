// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';
import { ItemOrderProfileService } from './item-order-profile.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ItemController],
  providers: [ItemService, ItemOrderProfileService, PrismaService],
  exports: [ItemService, ItemOrderProfileService],
})
export class ItemModule {}
