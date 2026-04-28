import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** Default permissions per built-in role – mirrors auth.service.ts DEFAULT_ROLES */
const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SuperAdmin: ['*'],
  Admin: [
    'users.*',
    'settings.*',
    'reports.*',
    'backup.*',
    'items.*',
    'transactions.*',
    'formulation.*',
    'opening-balances.*',
    'theme.*',
    'monitoring.logs.write',
  ],
  Manager: ['transactions.*', 'reports.view', 'items.view', 'formulation.view', 'opening-balances.view', 'backup.view'],
  Operator: ['transactions.create', 'transactions.update', 'transactions.delete', 'transactions.view', 'items.view'],
  Viewer: ['items.view', 'transactions.view', 'reports.view', 'formulation.view', 'opening-balances.view', 'backup.view'],
};

@Injectable()
export class AppBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

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

  private normalizeDistinctValues(rows: Array<{ value: string | null }>) {
    return rows
      .map((row) => String(row.value || '').trim())
      .filter(Boolean);
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

    const permissions = user ? this.parsePermissions(user.role?.permissions) : [];

    // Self-heal: if the DB role has no permissions (not yet seeded or wiped),
    // fall back to DEFAULT_ROLE_PERMISSIONS and repair the DB row non-blocking.
    const resolvedPermissions = (() => {
      if (permissions.length > 0 || !user?.role?.name) {
        return permissions;
      }

      const defaults = DEFAULT_ROLE_PERMISSIONS[user.role.name];
      if (!defaults || defaults.length === 0) {
        return permissions;
      }

      console.warn(`[AppBootstrap] Role "${user.role.name}" had empty permissions in DB – applying defaults.`);
      this.prisma.role
        .update({ where: { id: user.role.id }, data: { permissions: JSON.stringify(defaults) } })
        .catch((err: unknown) =>
          console.warn('[AppBootstrap] Non-blocking role-permissions repair failed:', (err as Error)?.message || err),
        );

      return defaults;
    })();

    const includeInactiveUnloadingRules =
      this.hasPermission(resolvedPermissions, 'settings.view.general') ||
      this.hasPermission(resolvedPermissions, 'settings.update.system');

    const [categoryRows, unitRows, unloadingRuleRows, itemsCount, transactionsCount, openingBalancesCount] = await Promise.all([
      this.prisma.item.findMany({
        where: { isArchived: false },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.item.findMany({
        where: { isArchived: false },
        distinct: ['unit'],
        select: { unit: true },
        orderBy: { unit: 'asc' },
      }),
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
        referenceData: {
          categories: this.normalizeDistinctValues(categoryRows.map((row) => ({ value: row.category }))),
          units: this.normalizeDistinctValues(unitRows.map((row) => ({ value: row.unit }))),
        },
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
        status: user.isActive ? 'active' : 'locked',
        scope: 'all',
      },
      resolvedPermissions: resolvedPermissions,
      referenceData: {
        categories: this.normalizeDistinctValues(categoryRows.map((row) => ({ value: row.category }))),
        units: this.normalizeDistinctValues(unitRows.map((row) => ({ value: row.unit }))),
      },
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