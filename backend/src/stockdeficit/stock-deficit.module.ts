import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { StockDeficitController } from './stock-deficit.controller';
import { StockDeficitService } from './stock-deficit.service';

@Module({
  imports: [AuthModule],
  controllers: [StockDeficitController],
  providers: [StockDeficitService, PrismaService],
  exports: [StockDeficitService],
})
export class StockDeficitModule {}
