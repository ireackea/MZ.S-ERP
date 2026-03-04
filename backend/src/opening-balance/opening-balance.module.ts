import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OpeningBalanceController } from './opening-balance.controller';
import { OpeningBalanceService } from './opening-balance.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [OpeningBalanceController],
  providers: [OpeningBalanceService, PrismaService],
  exports: [OpeningBalanceService],
})
export class OpeningBalanceModule {}
