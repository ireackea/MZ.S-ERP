import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';

@Injectable()
export class AppBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceDataService: ReferenceDataService,
  ) {}

  private hasPermission(permissions: string[], permission: string) {
    if (permissions.includes('*') || permissions.includes(permission)) {
      return true;
    }

    return permissions.some((granted) => {
      if (!granted.endsWith('.*')) {
        return false;
      }

      const prefix = granted.slice(0, -2);
      return permission === prefix || permission.startsWith(`${prefix}.`);
    });
  }

  private parsePermissions(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async getBootstrapPayload(principal: any) {
    const userId = String(principal?.id || principal?.sub || '').trim();
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          include: { role: true },
        })
      : null;

    if (userId && (!user || !user.isActive)) {
      throw new UnauthorizedException('Authenticated user is inactive or missing');
    }

    const resolvedPermissions = user ? this.parsePermissions(user.role?.permissions) : [];

    const includeInactiveUnloadingRules =
      this.hasPermission(resolvedPermissions, 'settings.view.general') ||
      this.hasPermission(resolvedPermissions, 'settings.update.system');

    const [referenceData, unloadingRuleRows, itemsCount, transactionsCount, openingBalancesCount] = await Promise.all([
      this.referenceDataService.findAll(),
      this.prisma.unloadingRule.findMany({
        where: includeInactiveUnloadingRules ? undefined : { isActive: true },
        orderBy: [{ isActive: 'desc' }, { ruleName: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.item.count({ where: { isArchived: false } }),
      this.prisma.transaction.count(),
      this.prisma.openingBalance.count(),
    ]);

    if (!user) {
      return {
        session: null,
        resolvedPermissions: [],
        referenceData,
        unloadingRules: unloadingRuleRows.map((row) => ({
          id: row.id,
          rule_name: row.ruleName,
          allowed_duration_minutes: row.allowedDurationMinutes,
          penalty_rate_per_minute: row.penaltyRatePerMinute.toNumber(),
          is_active: row.isActive,
        })),
        startupFlags: {
          hasItems: itemsCount > 0,
          hasTransactions: transactionsCount > 0,
          hasOpeningBalances: openingBalancesCount > 0,
        },
      };
    }

    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();

    return {
      session: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: fullName || user.username,
        role: user.role?.name || 'Viewer',
        roleId: user.roleId,
        permissions: resolvedPermissions,
        isActive: user.isActive,
        active: user.isActive,
        // FC-SEC-012 — this reported every inactive account as "locked". A
        // deactivated user and a security lock are different states, and the
        // client used this to decide what to show.
        isLocked: user.isLocked,
        status: user.isActive ? 'active' : user.isLocked ? 'locked' : 'inactive',
        scope: 'all',
      },
      resolvedPermissions: resolvedPermissions,
      referenceData,
      unloadingRules: unloadingRuleRows.map((row) => ({
        id: row.id,
        rule_name: row.ruleName,
        allowed_duration_minutes: row.allowedDurationMinutes,
        penalty_rate_per_minute: row.penaltyRatePerMinute.toNumber(),
        is_active: row.isActive,
      })),
      startupFlags: {
        hasItems: itemsCount > 0,
        hasTransactions: transactionsCount > 0,
        hasOpeningBalances: openingBalancesCount > 0,
      },
    };
  }
}