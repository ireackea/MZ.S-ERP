import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { BulkSyncDto } from './dto/sync-items.dto';
import { ItemService } from './item.service';
import { Get } from '@nestjs/common';
import { DeleteItemsDto } from './dto/delete-items.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Permissions('items.sync')
  @Post('sync')
  async sync(@Body() dto: BulkSyncDto) {
    return this.itemService.syncItems(dto.items);
  }

  @Permissions('items.delete')
  @Roles('Admin', 'SuperAdmin')
  @Post('delete')
  async deleteMany(@Body() dto: DeleteItemsDto) {
    return this.itemService.deleteByPublicIds(dto.publicIds);
  }

  @Permissions('items.generate_codes')
  @Post('generate-codes')
  async generateMissingCodes() {
    return this.itemService.generateMissingCodes();
  }

  @Permissions('items.view')
  @Get()
  async list() {
    return this.itemService.getAll();
  }
}
