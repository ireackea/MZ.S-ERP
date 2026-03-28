// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
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
  ) {
    return this.auditService.listLogs({
      actorId,
      action,
      status,
      limit: Number(limit || 500),
    });
  }

  @Permissions('users.audit')
  @Get('sessions')
  async getSessions(@Query('userId') userId?: string) {
    return this.auditService.listActiveSessions(userId);
  }
}
