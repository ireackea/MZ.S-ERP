// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
import { Body, Controller, Post, UseGuards, Get, Query, Req } from '@nestjs/common';
import { BulkSyncDto } from './dto/sync-items.dto';
import { ItemService } from './item.service';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';

export class ArchiveItemsDto {
  publicIds!: string[];
  userId?: string;
  actorUsername?: string;
}

export class RestoreItemsDto {
  publicIds!: string[];
  userId?: string;
  actorUsername?: string;
}

export class DeleteItemsPermanentDto {
  publicIds!: string[];
  userId?: string;
  actorUsername?: string;
}

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Permissions('items.sync')
  @Post('sync')
  async sync(@Body() dto: BulkSyncDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.syncItems(dto.items, userId, actorUsername);
  }

  @Permissions('items.delete')
  @Roles('Admin', 'SuperAdmin')
  @Post('delete')
  async deleteMany(@Body() dto: DeleteItemsDto) {
    return this.itemService.deleteByPublicIds(dto.publicIds);
  }

  @Permissions('items.archive')
  @Post('archive')
  async archive(@Body() dto: ArchiveItemsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.archiveItems(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.restore')
  @Post('restore')
  async restore(@Body() dto: RestoreItemsDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.restoreItems(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.delete')
  @Roles('Admin', 'SuperAdmin')
  @Post('delete-permanent')
  async deletePermanent(@Body() dto: DeleteItemsPermanentDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.deletePermanently(dto.publicIds, userId, actorUsername);
  }

  @Permissions('items.generate_codes')
  @Post('generate-codes')
  async generateMissingCodes(@Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.itemService.generateMissingCodes(userId, actorUsername);
  }

  @Permissions('items.view')
  @Get()
  async list(
    @Query('page') page = 1,
    @Query('limit') limit = 100,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isArchived') isArchived?: string,
  ) {
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const isArchivedBool = isArchived === 'true';

    return this.itemService.findAll({
      skip,
      take,
      search,
      category,
      isArchived: isArchivedBool,
    });
  }
}
