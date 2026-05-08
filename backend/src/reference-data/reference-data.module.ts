import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../prisma.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService, PrismaService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}