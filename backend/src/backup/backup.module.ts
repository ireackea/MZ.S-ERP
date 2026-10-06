import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
// B4 — the backup section writes no audit rows of its own; without this import the
// seven events it is supposed to leave behind have nowhere to go.
import { AuditModule } from '../audit/audit.module';
import { DatabaseInfrastructureModule } from '../database/database-infrastructure.module';
import { PrismaService } from '../prisma.service';
import { BackupController } from './backup.controller';
import { BackupGuard } from './backup.guard';
import { BackupService } from './backup.service';
import { BackupStateService } from './backup-state.service';

@Module({
  imports: [AuthModule, DatabaseInfrastructureModule, AuditModule],
  controllers: [BackupController],
  providers: [BackupService, BackupStateService, BackupGuard, PrismaService],
  exports: [BackupService, BackupStateService],
})
export class BackupModule {}
