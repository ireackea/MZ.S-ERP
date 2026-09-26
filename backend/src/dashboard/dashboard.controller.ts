// SECURITY FIX: 2026-03-28 - Added authentication and authorization
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { resolveWarehouseScope } from '../common/scope';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RbacGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Permissions('dashboard.view')
  @Get('stats')
  async getStats(@Req() req: any) {
    return this.dashboardService.getDashboardStats(resolveWarehouseScope(req.user?.role));
  }
}
