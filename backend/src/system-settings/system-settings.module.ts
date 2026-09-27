import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../prisma.service';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

/**
 * Gate 2.1 — company settings get a module, so they have one owner.
 *
 * Not a folder: the point is that a value has exactly one place it is read and
 * written from. While the only writer was a client-side store, the server could
 * not answer "what is the company name" and the report header was whatever the
 * last browser happened to hold.
 *
 * `PrismaService` is provided here the way every other feature module in this
 * codebase does it, rather than by introducing a PrismaModule: there is no such
 * module, and adding one is a change to how the whole app wires its database
 * access in order to solve a problem this module does not have.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService, PrismaService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
