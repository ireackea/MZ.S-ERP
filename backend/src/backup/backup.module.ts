import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { BackupController } from './backup.controller';
import { BackupGuard } from './backup.guard';
import { BackupService } from './backup.service';

@Module({
  imports: [AuthModule],
  controllers: [BackupController],
  providers: [BackupService, BackupGuard, PrismaService],
})
export class BackupModule {}
