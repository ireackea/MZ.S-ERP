import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ThemeService } from './theme.service';
import { ThemeController } from './theme.controller';
import { PrismaService } from '../prisma.service';

@Module({
  // AuditModule is imported because a theme write is a change to an account's settings
  // and has to leave a row. Omitting it made the audit call unresolvable at runtime —
  // a DI failure on first use rather than at boot, which is the worse of the two.
  imports: [AuthModule, AuditModule],
  controllers: [ThemeController],
  providers: [ThemeService, PrismaService],
})
export class ThemeModule {}