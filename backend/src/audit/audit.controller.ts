// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
// FC-AUD-001 — search, export, and retention-visible archived history.
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { AllowAuthenticated } from '../auth/decorators/allow-authenticated.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AuditAction, AuditService } from './audit.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Permissions('users.audit')
  @Get('logs')
  async getLogs(
    @Query('actorId') actorId?: string,
    @Query('action') action?: AuditAction,
    @Query('status') status?: 'success' | 'failed',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditService.queryLogs({
      actorId,
      action,
      status,
      limit: Number(limit || 500),
      offset: Number(offset || 0),
      search,
      entityType,
      entityId,
      from,
      to,
    });
  }

  @Permissions('users.audit')
  @Get('logs/export')
  @Header('Cache-Control', 'no-store')
  async exportLogs(
    @Res({ passthrough: true }) res: Response,
    @Query('actorId') actorId?: string,
    @Query('action') action?: AuditAction,
    @Query('status') status?: 'success' | 'failed',
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const result = await this.auditService.exportLogs({ actorId, action, status, search, from, to, limit: Number(limit || 5000) });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }

  // FC-AUD-001 — archived rows are retained, never deleted, and stay retrievable.
  @Permissions('users.audit')
  @Get('archived')
  async getArchived(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.auditService.listArchived(Number(limit || 500), Number(offset || 0));
  }

  @Permissions('users.audit')
  @Get('sessions')
  async getSessions(@Query('userId') userId?: string) {
    return this.auditService.listActiveSessions(userId);
  }

  /**
   * FC-AUD-001 — where the frontend's activity trail now goes. Previously these
   * entries were written to `localStorage`, which made the audit evidence
   * editable by whoever opened the browser. Every write is server-side and
   * redacted by AuditService.
   */
  @AllowAuthenticated()
  @Post('client-activity')
  @HttpCode(HttpStatus.CREATED)
  async recordClientActivity(
    @Req() req: Request & { user?: { id?: string; username?: string; role?: string } },
    @Body() body: { event?: string; details?: string },
  ) {
    const user = req.user || {};
    return this.auditService.logItemAction(
      String(user.id || 'system'),
      'CLIENT_ACTIVITY',
      'ClientSession',
      String(user.id || 'anonymous'),
      {
        event: String(body?.event || 'unknown').slice(0, 80),
        details: String(body?.details || '').slice(0, 500),
        ipAddress: req.ip,
      },
      String(user.username || 'system'),
      'SUCCESS',
      { actorRole: String(user.role || 'user') },
    );
  }
}
