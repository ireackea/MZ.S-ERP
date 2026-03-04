// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable, OnModuleInit, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    const prismaWithEvents = this as PrismaClient & {
      $on: (eventType: 'beforeExit', callback: () => Promise<void>) => void;
    };
    prismaWithEvents.$on('beforeExit', async () => {
      await app.close();
    });
  }
}
