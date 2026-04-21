import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../prisma.service';
import { FormulationController } from './formulation.controller';
import { FormulationService } from './formulation.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [FormulationController],
  providers: [FormulationService, PrismaService],
  exports: [FormulationService],
})
export class FormulationModule {}