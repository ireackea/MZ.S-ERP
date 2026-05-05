import { Module } from '@nestjs/common';
// AuditModule مُضافة لتمكين حقن AuditService داخل TransactionService
// وتسجيل جميع العمليات المالية (إنشاء/تحديث/حذف) في سجل التدقيق
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { BalancesController } from './balances.controller';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [TransactionController, BalancesController],
  providers: [TransactionService, PrismaService],
  exports: [TransactionService],
})
export class TransactionModule {}
