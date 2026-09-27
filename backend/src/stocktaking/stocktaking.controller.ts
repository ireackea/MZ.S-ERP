import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { resolveWarehouseScope } from '../common/scope';
import { CloseStocktakingDto, CreateStocktakingSessionDto, StocktakingQueryDto, UpsertStocktakingEntryDto } from './dto/stocktaking.dto';
import { StocktakingService } from './stocktaking.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('stocktaking')
export class StocktakingController {
  constructor(private readonly stocktakingService: StocktakingService) {}

  @Permissions('inventory.view.stocktaking')
  @Get(':monthKey')
  get(@Param('monthKey') monthKey: string, @Query() query: StocktakingQueryDto, @Req() req: any) {
    return this.stocktakingService.get(monthKey, resolveWarehouseScope(req.user?.role, query.warehouseId));
  }

  @Permissions('inventory.create.stocktaking')
  @Post()
  create(@Body() dto: CreateStocktakingSessionDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.stocktakingService.create({ ...dto, warehouseId: resolveWarehouseScope(req.user?.role, dto.warehouseId) }, req.user?.sub || req.user?.id, req.user?.username, key);
  }

  @Permissions('inventory.update.stocktaking')
  @Put(':id/entries')
  upsertEntry(@Param('id') id: string, @Body() dto: UpsertStocktakingEntryDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.stocktakingService.upsertEntry(id, dto, req.user?.sub || req.user?.id, req.user?.username, key, req.user?.role === 'SuperAdmin' ? 'all' : 'default');
  }

  @Permissions('inventory.update.stocktaking')
  @Post(':id/entries/:entryId/resolve')
  resolveEntry(@Param('id') id: string, @Param('entryId') entryId: string, @Body() dto: UpsertStocktakingEntryDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.stocktakingService.resolveEntry(id, entryId, dto, req.user?.sub || req.user?.id, req.user?.username, key, req.user?.role === 'SuperAdmin' ? 'all' : 'default');
  }

  @Permissions('inventory.update.stocktaking')
  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.stocktakingService.reopen(id, req.user?.sub || req.user?.id, req.user?.username, key, req.user?.role === 'SuperAdmin' ? 'all' : 'default');
  }

  @Permissions('inventory.close.stocktaking')
  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: CloseStocktakingDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.stocktakingService.close(id, dto, req.user?.sub || req.user?.id, req.user?.username, key, req.user?.role === 'SuperAdmin' ? 'all' : 'default');
  }
}
