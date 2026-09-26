// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Module } from '@nestjs/common';
import { AppBootstrapModule } from './app-bootstrap/app-bootstrap.module';
import { AuthModule } from './auth/auth.module';
import { ThemeModule } from './theme/theme.module';
import { BackupModule } from './backup/backup.module';
import { OpeningBalanceModule } from './opening-balance/opening-balance.module';
import { ItemModule } from './item/item.module';
// DEF-001 — the deficit queue: a clamped over-issue is recorded, visible and resolvable.
import { StockDeficitModule } from './stockdeficit/stock-deficit.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { ReportModule } from './report/report.module';
import { ReportsModule } from './reports/report.module';
import { TransactionModule } from './transaction/transaction.module';
import { UsersModule } from './users/users.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FormulationModule } from './formulation/formulation.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UnloadingRuleModule } from './unloading-rule/unloading-rule.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { TimeModule } from './common/time/time.module';
import { PartnersModule } from './partners/partners.module';
import { OrdersModule } from './orders/orders.module';
import { StocktakingModule } from './stocktaking/stocktaking.module';

@Module({
  imports: [
    AppBootstrapModule,
    RealtimeModule,
    AuthModule,
    ThemeModule,
    BackupModule,
    OpeningBalanceModule,
    ItemModule,
    StockDeficitModule,
    MonitoringModule,
    ReportModule,
    ReportsModule,
    TransactionModule,
    UsersModule,
    FormulationModule,
    UnloadingRuleModule,
    ReferenceDataModule,
    TimeModule,
    PartnersModule,
    OrdersModule,
    StocktakingModule,
    DashboardModule, // ENTERPRISE FIX: Dashboard module registration
  ],
})
export class AppModule {}
