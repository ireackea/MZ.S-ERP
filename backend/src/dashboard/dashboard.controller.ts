// SECURITY FIX: 2026-03-28 - Added authentication and authorization
import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RbacGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Permissions('dashboard.view')
  @Get('stats')
  async getStats() {
    return this.dashboardService.getDashboardStats();
  }
}
