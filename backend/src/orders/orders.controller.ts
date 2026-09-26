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

  @Permissions('sales.update.orders')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.update(id, { ...dto, warehouseId: req.user?.role === 'SuperAdmin' ? dto.warehouseId : 'default' }, req.user?.sub || req.user?.id, req.user?.username, key);
  }

  @Permissions('sales.update.orders')
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() dto: CompleteOrderDto, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.complete(id, resolveWarehouseScope(req.user?.role, dto.warehouseId), req.user?.sub || req.user?.id, req.user?.username, key);
  }

  @Permissions('sales.delete.orders')
  @Roles('Admin', 'SuperAdmin')
  @Delete(':id')
  remove(@Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: any) {
    return this.ordersService.remove(id, req.user?.sub || req.user?.id, req.user?.username, key, req.user?.role === 'SuperAdmin' ? 'all' : 'default');
  }
}
