import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { isPermissionGranted } from '../auth/permission-matching';

/**
 * FC-SEC-011 / #19 — ownership, and a write that leaves a trace.
 *
 * Both routes took the target account from the path and never checked who was asking.
 * `GET /theme/user/:id` read any account's theme, and `POST /theme/user/:id` **wrote**
 * any account's theme — so a session holding `theme.update` could alter another
 * person's row with no ownership check and no audit row. A permission that grants
 * "change a theme" must not, as a side effect, grant "change anyone's account".
 *
 * An administrator may still set another account's theme, because that is a legitimate
 * support action — but it is a separate authority (`users.update`), it is recorded, and
 * the audit row names whose row was touched, because "who changed my settings" needs an
 * answer.
 *
 * Note on the feature itself: the live theme is client-side (`theme.store` /
 * `ThemeSwitcher`), nothing in the frontend calls these routes, and `user.theme` is read
 * by nothing but this service. So these endpoints are a capability the UI does not use.
 * They are made correct rather than deleted — removing a feature someone may intend to
 * revive is a product decision, while leaving an unaudited cross-account write is a
 * defect, and only one of those is mine to decide.
 */
@Injectable()
export class ThemeService {
  private readonly logger = new Logger(ThemeService.name);

  constructor(
    private prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getUserTheme(userId: string, actor: { id: string; permissions: string[] }) {
    await this.assertMayTarget(userId, actor, 'read');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user.theme;
  }

  async updateUserTheme(
    userId: string,
    theme: string,
    actor: { id: string; permissions: string[] },
  ) {
    await this.assertMayTarget(userId, actor, 'write');
    const user = await this.prisma.user.update({ where: { id: userId }, data: { theme } });

    // Written after the update commits, and never allowed to fail the request: the
    // operator's action succeeded, and reporting it as failed would be a lie about the
    // only part that matters. A missing audit line is logged instead.
    await this.audit.log({
      action: 'THEME_UPDATED',
      actorId: actor.id,
      actorUsername: actor.id,
      actorRole: 'unknown',
      targetUserId: userId,
      targetResource: 'user',
      entityType: 'User',
      entityId: userId,
      status: 'success',
      message: `theme set to "${theme}"`,
      metadata: { self: userId === actor.id },
    }).catch((error: any) => {
      this.logger.error(`Theme saved but the audit write failed: ${error?.message || error}`);
    });

    return user;
  }

  /**
   * Own account, or an administrator acting on someone else's.
   *
   * `permission` is part of the message rather than the code because the operator needs
   * to know *which* right they lack, and a single opaque 403 for both cases is the
   * reason people escalate to someone who can read the source.
   */
  private async assertMayTarget(
    targetUserId: string,
    actor: { id: string; permissions: string[] },
    permission: 'read' | 'write',
  ) {
    if (targetUserId === actor.id) return;

    const isAdministrator = isPermissionGranted(actor.permissions, ['users.update']);
    if (isAdministrator) return;

    throw new ForbiddenException(
      permission === 'write'
        ? 'لا يمكنك تغيير ثيم حساب آخر. يتطلب ذلك صلاحية تعديل المستخدمين.'
        : 'لا يمكنك عرض ثيم حساب آخر.',
    );
  }
}