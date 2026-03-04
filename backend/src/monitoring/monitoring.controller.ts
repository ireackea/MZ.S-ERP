import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { ClientLogDto } from './dto/client-log.dto';
import { SystemResetDto } from './dto/system-reset.dto';
import { MonitoringService } from './monitoring.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller()
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Public()
  @Get('health')
  async getHealth() {
    return this.monitoringService.getHealth();
  }

  @Permissions('admin.reset_system')
  @Post('admin/reset-system')
  async resetSystem(@Body() dto: SystemResetDto, @Req() req: any) {
    const user = req.user;
    return this.monitoringService.performSystemReset(dto, user);
  }

  @Permissions('monitoring.logs.write')
  @Post('logs')
  @HttpCode(HttpStatus.ACCEPTED)
  async writeClientLog(@Body() dto: ClientLogDto, @Req() req: Request) {
    const ipHeader = req.headers['x-forwarded-for'];
    const ip = Array.isArray(ipHeader) ? ipHeader[0] : ipHeader ?? req.ip;
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    return this.monitoringService.writeClientLog(dto, {
      ip: String(ip || 'unknown'),
      userAgent: String(userAgent),
      path: req.path,
    });
  }
}
