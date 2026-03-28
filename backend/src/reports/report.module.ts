// ENTERPRISE FIX: Legacy Migration Phase 3 - Professional PDF Reporting - 2026-02-27
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportsModule {}

