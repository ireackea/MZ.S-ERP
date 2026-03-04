import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [AuthModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, PrismaService],
})
export class MonitoringModule {}
