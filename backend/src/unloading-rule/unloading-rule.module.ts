import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../prisma.service';
import { UnloadingRuleController } from './unloading-rule.controller';
import { UnloadingRuleService } from './unloading-rule.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UnloadingRuleController],
  providers: [UnloadingRuleService, PrismaService],
  exports: [UnloadingRuleService],
})
export class UnloadingRuleModule {}