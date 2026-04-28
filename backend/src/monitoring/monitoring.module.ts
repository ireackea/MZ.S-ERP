import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseInfrastructureModule } from '../database/database-infrastructure.module';
import { PrismaService } from '../prisma.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [AuthModule, DatabaseInfrastructureModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, PrismaService],
})
export class MonitoringModule {}
