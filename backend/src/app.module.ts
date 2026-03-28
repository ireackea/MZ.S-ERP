// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ThemeModule } from './theme/theme.module';
import { BackupModule } from './backup/backup.module';
import { OpeningBalanceModule } from './opening-balance/opening-balance.module';
import { ItemModule } from './item/item.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { ReportModule } from './report/report.module';
import { ReportsModule } from './reports/report.module';
import { TransactionModule } from './transaction/transaction.module';
import { UsersModule } from './users/users.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    RealtimeModule,
    AuthModule,
    ThemeModule,
    BackupModule,
    OpeningBalanceModule,
    ItemModule,
    MonitoringModule,
    ReportModule,
    ReportsModule,
    TransactionModule,
    UsersModule,
    DashboardModule, // ENTERPRISE FIX: Dashboard module registration
  ],
})
export class AppModule {}
