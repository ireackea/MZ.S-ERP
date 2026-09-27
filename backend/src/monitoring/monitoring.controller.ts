// ENTERPRISE FIX: Phase 7 - Advanced System Reset Module with Multi-Layer Security - 2026-04-29
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { ClientLogDto } from './dto/client-log.dto';
import { ResetChallengeDto, ResetPreviewDto, SystemResetDto } from './dto/system-reset.dto';
import { MonitoringService } from './monitoring.service';

const extractRequestMeta = (req: Request) => {
  const ipHeader = req.headers['x-forwarded-for'];
  const ip = Array.isArray(ipHeader) ? ipHeader[0] : ipHeader ?? req.ip;
  const userAgent = req.headers['user-agent'] ?? 'unknown';
  return {
    ip: String(ip || 'unknown'),
    userAgent: String(userAgent),
  };
};

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller()
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Public()
  @Get('health')
  async getHealth() {
    const health = await this.monitoringService.getHealth();
    if (health.status !== 'healthy') {
      throw new ServiceUnavailableException(health);
    }
    return health;
  }

  // Step 1: Generate a per-session one-time challenge code (second factor).
  @Permissions('admin.reset_system')
  @Post('admin/reset-system/challenge')
  async issueResetChallenge(@Body() dto: ResetChallengeDto, @Req() req: Request & { user?: any }) {
    const meta = extractRequestMeta(req);
    return this.monitoringService.issueResetChallenge(dto, req.user, meta);
  }

  // Step 2: Execute the reset using both factors (env token + one-time challenge).
  /**
   * Gate 2.2 - what this reset would delete, counted.
   *
   * Read-only, and deliberately not behind a challenge: its whole purpose is to be
   * called before the operator types a password and a justification, and asking
   * for those first would defeat it. It reveals row counts of tables the caller
   * can already reach through their own permissions, and it writes nothing.
   */
  @Permissions('admin.reset_system')
  @Post('admin/reset-system/preview')
  async previewReset(@Body() dto: ResetPreviewDto, @Req() req: Request & { user?: any }) {
    return this.monitoringService.previewSystemReset(dto.scope, req.user);
  }

  @Permissions('admin.reset_system')
  @Post('admin/reset-system')
  async resetSystem(@Body() dto: SystemResetDto, @Req() req: Request & { user?: any }) {
    const meta = extractRequestMeta(req);
    return this.monitoringService.performSystemReset(dto, req.user, meta);
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
