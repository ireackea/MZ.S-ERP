import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { resolveWarehouseScope } from '../common/scope';
import { CompleteOrderDto, CreateOrderDto, UpdateOrderDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Permissions('sales.view.orders')
  @Get()
  list(@Query('warehouseId') warehouseId: string | undefined, @Req() req: any) {
    return this.ordersService.list(resolveWarehouseScope(req.user?.role, warehouseId));
  }

  @Permissions('sales.create.orders')
  @Post()
  create(@Body() dto: CreateOrderDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.create({ ...dto, warehouseId: resolveWarehouseScope(req.user?.role, dto.warehouseId) }, req.user?.sub || req.user?.id, req.user?.username, key);
  }

  // Every verb resolves its scope through the one owner. Four of these used to spell the
  // rule out inline as `role === 'SuperAdmin' ? 'all' : 'default'`, which agrees with
  // `resolveWarehouseScope` today and would stop agreeing the day that function grew a
  // branch — and a diverging scope shows up as either another warehouse's orders or an
  // operator unable to edit their own.
  @Permissions('sales.update.orders')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.update(id, { ...dto }, req.user?.sub || req.user?.id, req.user?.username, key, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('sales.update.orders')
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteOrderDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.complete(id, resolveWarehouseScope(req.user?.role, dto.warehouseId), req.user?.sub || req.user?.id, req.user?.username, key);
  }

  @Permissions('sales.delete.orders')
  @Delete(':id')
  remove(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.remove(id, req.user?.sub || req.user?.id, req.user?.username, key, resolveWarehouseScope(req.user?.role));
  }
}
