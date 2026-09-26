import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionModule } from '../transaction/transaction.module';
import { StocktakingController } from './stocktaking.controller';
import { StocktakingService } from './stocktaking.service';

@Module({
  imports: [AuthModule, AuditModule, RealtimeModule, TransactionModule],
  controllers: [StocktakingController],
  providers: [StocktakingService, PrismaService],
})
export class StocktakingModule {}
