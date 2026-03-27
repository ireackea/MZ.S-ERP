// ENTERPRISE FIX: Phase 6 Final Polish + Full E2E Tests + Deployment Guide - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [RealtimeModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
