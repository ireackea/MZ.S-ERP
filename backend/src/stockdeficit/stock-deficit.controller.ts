import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { StockDeficitService } from './stock-deficit.service';

/**
 * DEF-001 — the deficit queue endpoints. Reading the queue needs the same
 * permission as viewing inventory; resolving one is a separate, higher
 * permission so that "make the alert disappear" is never a side effect of
 * looking at the dashboard.
 */
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('stock-deficits')
export class StockDeficitController {
  constructor(private readonly deficitService: StockDeficitService) {}

  @Get()
  @Permissions('inventory.view.stocktaking')
  async list(
    @Query('status') status: string | undefined,
    @Query('itemId') itemId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    return this.deficitService.list({
      status,
      itemId,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 500),
      offset: Math.max(Number(offset) || 0, 0),
    });
  }

  @Get('item/:itemPublicId')
  @Permissions('inventory.view.stocktaking')
  async forItem(@Param('itemPublicId') itemPublicId: string) {
    return this.deficitService.openForItem(itemPublicId);
  }

  @Post(':publicId/write-off')
  @Permissions('inventory.adjust.stock')
  async writeOff(
    @Param('publicId') publicId: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.deficitService.writeOff(publicId, {
      reason: String(body?.reason || ''),
      actorId: req.user?.sub || req.user?.id || 'system',
    });
  }

  @Post(':publicId/reopen')
  @Permissions('inventory.adjust.stock')
  async reopen(@Param('publicId') publicId: string, @Req() req: any) {
    return this.deficitService.reopen(publicId, req.user?.sub || req.user?.id || 'system');
  }
}
