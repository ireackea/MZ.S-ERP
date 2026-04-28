import { Module } from '@nestjs/common';
import { DatabaseInfrastructureService } from './database-infrastructure.service';

@Module({
  providers: [DatabaseInfrastructureService],
  exports: [DatabaseInfrastructureService],
})
export class DatabaseInfrastructureModule {}