import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ThemeService } from './theme.service';
import { ThemeController } from './theme.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [ThemeController],
  providers: [ThemeService, PrismaService],
})
export class ThemeModule {}
