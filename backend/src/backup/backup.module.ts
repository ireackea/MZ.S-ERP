import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseInfrastructureModule } from '../database/database-infrastructure.module';
import { PrismaService } from '../prisma.service';
import { BackupController } from './backup.controller';
import { BackupGuard } from './backup.guard';
import { BackupService } from './backup.service';

@Module({
  imports: [AuthModule, DatabaseInfrastructureModule],
  controllers: [BackupController],
  providers: [BackupService, BackupGuard, PrismaService],
  exports: [BackupService],
})
export class BackupModule {}
