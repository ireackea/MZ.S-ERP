// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
import { Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ClientLogDto } from './dto/client-log.dto';
import { SystemResetDto } from './dto/system-reset.dto';

type HealthStatus = {
  status: 'healthy' | 'degraded';
  uptime: number;
  timestamp: string;
  dbConnected: boolean;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
};

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getResetToken(): string {
    const resetToken = String(process.env.RESET_TOKEN || '').trim();
    if (!resetToken) {
      throw new InternalServerErrorException('RESET_TOKEN is not configured.');
    }
    return resetToken;
  }

  async getHealth(): Promise<HealthStatus> {
    let dbConnected = false;
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const mem = process.memoryUsage();
    return {
      status: dbConnected ? 'healthy' : 'degraded',
      uptime: Number(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString(),
      dbConnected,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
    };
  }

  writeClientLog(dto: ClientLogDto, meta: { ip?: string; userAgent?: string; path?: string }) {
    const event = {
      event: 'client_log',
      level: dto.level ?? 'info',
      message: dto.message,
      source: dto.source ?? 'frontend',
      metadata: dto.metadata ?? {},
      ip: meta.ip ?? 'unknown',
      userAgent: meta.userAgent ?? 'unknown',
      path: meta.path ?? 'unknown',
      timestamp: new Date().toISOString(),
    };

    // Keep logs structured JSON for downstream parsing.
    this.logger.log(JSON.stringify(event));
    return {
      accepted: true,
      timestamp: event.timestamp,
    };
  }

  // ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
  async performSystemReset(dto: SystemResetDto, user: any) {
    this.logger.warn(`SYSTEM RESET REQUESTED by user ${user?.username} (ID: ${user?.id})`);

    // Strict validation for confirmation code
    if (dto.confirmationCode !== this.getResetToken()) {
      throw new UnauthorizedException('Invalid confirmation code. Please use the exact code from the manual.');
    }

    // Role check - Only SuperAdmin can reset
    if (user.role !== 'SuperAdmin') {
      throw new UnauthorizedException('Permission Denied: Only SuperAdmin can perform a system reset.');
    }

    try {
      this.logger.log('Starting full system reset (Truncating operational tables)...');
      
      // Execute reset in a transaction for atomicity
      await this.prisma.$transaction([
        this.prisma.transaction.deleteMany({}),
        this.prisma.openingBalance.deleteMany({}),
        this.prisma.item.deleteMany({}),
        // Preserve Users and Roles to prevent complete lockout
      ]);

      this.logger.log('System reset completed successfully.');

      return {
        success: true,
        message: 'تم تصفير جميع بيانات النظام والمخزون بنجاح. النظام جاهز للتهيئة الجديدة.',
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      this.logger.error('CRITICAL: System reset failed:', error.stack);
      throw error;
    }
  }
}

