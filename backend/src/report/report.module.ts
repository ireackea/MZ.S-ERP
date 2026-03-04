import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportController],
  providers: [ReportService, PrismaService],
})
export class ReportModule {}
