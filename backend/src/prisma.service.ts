// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, OnModuleInit, INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = String(process.env.DATABASE_URL || '').trim();
    super({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    const shutdown = async () => {
      await this.$disconnect();
      await app.close();
    };

    process.once('SIGINT', () => {
      void shutdown();
    });

    process.once('SIGTERM', () => {
      void shutdown();
    });
  }
}
