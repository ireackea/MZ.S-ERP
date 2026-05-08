import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { AppBootstrapController } from './app-bootstrap.controller';
import { AppBootstrapService } from './app-bootstrap.service';

@Module({
  imports: [AuthModule, ReferenceDataModule],
  controllers: [AppBootstrapController],
  providers: [AppBootstrapService, PrismaService],
})
export class AppBootstrapModule {}