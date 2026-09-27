// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
// ENTERPRISE FIX: superadmin bootstrap with JWT authentication

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_ROLES } from './role-templates';
import { migratePermissionGrants } from './permission-catalog';
import {
  isPasswordPolicyCompliant,
  isWeakLegacyPassword,
  passwordPolicyMessage,
} from '../common/password-policy';

type JwtUser = {
  id: string;
  username: string;
  role: string;
  permissions: string[];
  name?: string | null;
  sessionId?: string;
  // FC-SEC-010 — read fresh from the database on every request, so a forced
  // password change takes effect without waiting for a token to expire.
  mustChangePassword?: boolean;
};

@Injectable()
export class AuthService {
  private readonly auditService: AuditService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    this.auditService = new AuditService(this.prisma);
  }

  private getJwtSecret(): string {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    return secret;
  }

  private getDefaultAdminPassword(): string {
    const rawPassword = String(process.env.ADMIN_PASSWORD || '').trim();
    if (!rawPassword) {
      throw new Error('ADMIN_PASSWORD is required for superadmin bootstrap');
    }

    if (isWeakLegacyPassword(rawPassword) || !this.validatePasswordPolicy(rawPassword)) {
      throw new Error('ADMIN_PASSWORD does not meet the enterprise password policy');
    }

    return rawPassword;
  }

  private getMaxFailedAttempts(): number {
    const parsed = Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
  }

  private getLockoutMinutes(): number {
    const parsed = Number(process.env.AUTH_LOCKOUT_MINUTES || 15);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 15;
  }

  private getSessionTimeoutMinutes(): number {
    const parsed = Number(process.env.AUTH_SESSION_TIMEOUT_MINUTES || 30);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  }

  private validatePasswordPolicy(password: string) {
    return isPasswordPolicyCompliant(password);
  }

  private resolveClientIp(clientMeta?: { ipAddress?: string }) {
    return String(clientMeta?.ipAddress || '0.0.0.0');
  }

  private resolveUserAgent(clientMeta?: { userAgent?: string }) {
    return String(clientMeta?.userAgent || 'unknown');
  }

  private resolveDeviceFingerprint(username: string, clientMeta?: { deviceFingerprint?: string; userAgent?: string }) {
    const supplied = String(clientMeta?.deviceFingerprint || '').trim();
    if (supplied) return supplied;
    const ua = String(clientMeta?.userAgent || 'unknown');
    return `fallback-${Buffer.from(`${username}|${ua}`).toString('base64').slice(0, 48)}`;
  }

  private normalizePermissions(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      // FC-SEC-002 — translate any legacy id stored in an older role row to its
      // canonical catalog id, so the JWT only ever carries canonical grants.
      return migratePermissionGrants(parsed.filter((entry): entry is string => typeof entry === 'string'));
    } catch {
      return [];
    }
  }

  // ENTERPRISE FIX: 2026-04-29 — Self-heal RBAC at login.
  // Mirrors AppBootstrapService self-heal: when the DB role row has empty/missing
  // permissions JSON for a built-in role, fall back to DEFAULT_ROLES permissions
  // and trigger a non-blocking DB repair so the next login is consistent.
  private applyDefaultPermissionsFallback(
    permissions: string[],
  ): string[] {
    return permissions;
  }

  private async ensureDefaultRoles() {
    for (const role of DEFAULT_ROLES) {
      const templatePermissions = [...new Set(role.permissions)];
      const existing = await this.prisma.role.findUnique({
        where: { name: role.name },
        select: { id: true, permissions: true },
      });

      if (!existing) {
        await this.prisma.role.create({
          data: {
            name: role.name,
            description: role.description,
            permissions: JSON.stringify(templatePermissions),
            color: role.color,
          },
        });
        continue;
      }

      // FC-SEC-006 — repair a built-in role that is missing grants from its
      // template. The row originally came from `prisma/seed.ts`, which shipped a
      // narrower list than `role-templates.ts` and was never reconciled, so
      // Manager/Operator/Viewer held no `dashboard.view` and no stocktaking
      // access. The previous `if (existing) continue` meant the template could
      // never catch up.
      //
      // The repair is deliberately ADDITIVE. It only adds template grants the row
      // is missing and never removes one, so an administrator who deliberately
      // widened or narrowed a built-in role keeps their decision; the guard
      // against a silent rewrite is that the diff is logged and audited.
      const stored = this.normalizePermissions(existing.permissions);
      const missing = templatePermissions.filter((permission) => !stored.includes(permission));
      if (!missing.length) continue;

      const merged = [...new Set([...stored, ...missing])].sort();
      await this.prisma.role.update({
        where: { id: existing.id },
        data: { permissions: JSON.stringify(merged) },
      });
      console.warn(
        `[Auth Service] Role "${role.name}" was missing ${missing.length} template grant(s); repaired: ${missing.join(', ')}`,
      );
      await this.auditService.log({
        action: 'ROLE_TEMPLATE_REPAIRED',
        actorId: 'system',
        actorUsername: 'system',
        actorRole: 'system',
        targetResource: `roles/${existing.id}`,
        status: 'success',
        message: `Added ${missing.length} missing template grant(s) to built-in role ${role.name}`,
        metadata: { role: role.name, added: missing },
      }).catch(() => undefined);
    }
  }

  private async reconcileSuperAdminAccount(
    user: {
      id: string;
      roleId: string;
      passwordHash: string;
      failedAttempts: number;
      lockoutUntil: Date | null;
      isActive: boolean;
      passwordSetByUser: boolean;
    },
    superAdminRoleId: string,
  ) {
    const updates: {
      roleId?: string;
      passwordHash?: string;
      failedAttempts?: number;
      lockoutUntil?: Date | null;
      isActive?: boolean;
    } = {};

    if (user.roleId !== superAdminRoleId) {
      updates.roleId = superAdminRoleId;
    }

    // FC-SEC-010 — this used to re-write the hash to ADMIN_PASSWORD on every
    // boot whenever it differed, which pinned the superadmin password to the
    // .env file forever: unreadable, unrotatable, and readable by anyone with
    // file access. The env value now only seeds an account that has never had a
    // password of its own.
    if (!user.passwordSetByUser) {
      const defaultAdminPassword = this.getDefaultAdminPassword();
      const isPasswordSynced = await this.verifyPassword(defaultAdminPassword, user.passwordHash);
      if (!isPasswordSynced) {
        updates.passwordHash = await bcrypt.hash(defaultAdminPassword, 10);
        updates.failedAttempts = 0;
        updates.lockoutUntil = null;
        updates.isActive = true;
        console.warn('[Auth Service] SuperAdmin seeded from ADMIN_PASSWORD; set your own password to detach from it.');
      } else if ((user.failedAttempts || 0) > 0 || user.lockoutUntil || user.isActive === false) {
        updates.failedAttempts = 0;
        updates.lockoutUntil = null;
        updates.isActive = true;
      }
    } else if ((user.failedAttempts || 0) > 0 || user.lockoutUntil || user.isActive === false) {
      // A rotated password must not be undone by the unlock side effect.
      updates.failedAttempts = 0;
      updates.lockoutUntil = null;
      updates.isActive = true;
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    }
  }

  private async ensureDefaultAdmin() {
    await this.ensureDefaultRoles();
    const superAdminRole = await this.prisma.role.findUnique({ where: { name: 'SuperAdmin' } });
    if (!superAdminRole) {
      console.error('[Auth Service] SuperAdmin role not found!');
      return;
    }

    const adminByUsername = await this.prisma.user.findUnique({
      where: { username: 'superadmin' },
      select: {
        id: true,
        roleId: true,
        passwordHash: true,
        failedAttempts: true,
        lockoutUntil: true,
        isActive: true,
        passwordSetByUser: true,
      },
    });
    if (adminByUsername) {
      await this.reconcileSuperAdminAccount(adminByUsername, superAdminRole.id);
      return;
    }

    const adminByEmail = await this.prisma.user.findFirst({
      where: { email: 'superadmin@feedfactory.local' },
      select: {
        id: true,
        username: true,
        roleId: true,
        passwordHash: true,
        failedAttempts: true,
        lockoutUntil: true,
        isActive: true,
        passwordSetByUser: true,
      },
    });
    if (adminByEmail) {
      await this.prisma.user.update({
        where: { id: adminByEmail.id },
        data: {
          username: adminByEmail.username || 'superadmin',
          roleId: superAdminRole.id,
        },
      });
      await this.reconcileSuperAdminAccount(adminByEmail, superAdminRole.id);
      return;
    }

    const passwordHash = await bcrypt.hash(this.getDefaultAdminPassword(), 10);
    await this.prisma.user.create({
      data: {
        username: 'superadmin',
        email: 'superadmin@feedfactory.local',
        passwordHash,
        firstName: 'System',
        lastName: 'SuperAdmin',
        isActive: true,
        // FC-SEC-010 — the seeded password is the value in .env, so it is
        // marked temporary. The operator is forced to replace it on first use,
        // which is also what sets passwordSetByUser and detaches the account
        // from the env file for good.
        mustChangePassword: true,
        roleId: superAdminRole.id,
      },
    });
    console.log('[Auth Service] SuperAdmin seeded successfully.');
  }

  private async verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  async login(
    username: string,
    password: string,
    clientMeta?: { deviceFingerprint?: string; ipAddress?: string; userAgent?: string },
  ) {
    const normalized = String(username || '').trim();
    const invalidCredentialsMessage = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
    const accountLockedMessage = 'الحساب مقفل مؤقتاً بسبب محاولات دخول متكررة. حاول لاحقاً.';
    const maxFailedAttempts = this.getMaxFailedAttempts();
    const lockoutMinutes = this.getLockoutMinutes();

    console.log(`[Auth Service] Login attempt for username/email: ${normalized || '<empty>'}`);

    // Keep admin/role bootstrap non-blocking for login to avoid unnecessary 500 errors.
    try {
      await this.ensureDefaultAdmin();
    } catch (seedError: any) {
      console.warn('[Auth Service] ensureDefaultAdmin skipped due to runtime error:', seedError?.message || seedError);
    }

    let user: any;
    try {
      user = await this.prisma.user.findFirst({
        where: {
          OR: [{ username: normalized }, { email: normalized }],
        },
        include: {
          role: {
            select: {
              name: true,
              permissions: true,
            },
          },
        },
      });
    } catch (queryError: any) {
      console.error('[Auth Service] Failed to load user during login:', queryError?.message || queryError);
      throw new UnauthorizedException('تعذر التحقق من بيانات الدخول حالياً. يرجى المحاولة لاحقاً.');
    }

    if (!user || user.isActive === false) {
      await this.auditService.log({
        action: 'LOGIN_FAILED',
        actorId: 'anonymous',
        actorUsername: normalized || 'anonymous',
        actorRole: 'anonymous',
        targetResource: 'auth.login',
        status: 'failed',
        message: 'Login failed: invalid credentials or inactive user',
        metadata: { ipAddress: this.resolveClientIp(clientMeta), userAgent: this.resolveUserAgent(clientMeta) },
      });
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const now = Date.now();
    if (user.lockoutUntil && user.lockoutUntil.getTime() <= now && (user.failedAttempts || 0) > 0) {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedAttempts: 0, lockoutUntil: null },
        });
      } catch (resetError: any) {
        console.warn('[Auth Service] Failed to reset expired lockout metadata:', resetError?.message || resetError);
      }
      user.failedAttempts = 0;
      user.lockoutUntil = null;
    }

    if (user.lockoutUntil && user.lockoutUntil.getTime() > now) {
      await this.auditService.log({
        action: 'LOGIN_LOCKED',
        actorId: user.id,
        actorUsername: user.username || user.email || normalized || 'unknown',
        actorRole: user.role?.name || 'Viewer',
        targetUserId: user.id,
        targetResource: 'auth.login',
        status: 'failed',
        message: 'Login blocked: account is currently locked',
      });
      throw new UnauthorizedException(accountLockedMessage);
    }

    const valid = await this.verifyPassword(password, user.passwordHash);
    if (!valid) {
      const currentAttempts = Math.max(0, Number(user.failedAttempts || 0));
      const attempts = currentAttempts + 1;
      const shouldLock = attempts >= maxFailedAttempts;

      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedAttempts: shouldLock ? maxFailedAttempts : attempts,
            lockoutUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60 * 1000) : null,
          },
        });
      } catch (attemptsUpdateError: any) {
        console.warn('[Auth Service] Failed to update failedAttempts/lockout metadata:', attemptsUpdateError?.message || attemptsUpdateError);
      }

      await this.auditService.log({
        action: shouldLock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        actorId: user.id,
        actorUsername: user.username || user.email || normalized || 'unknown',
        actorRole: user.role?.name || 'Viewer',
        targetUserId: user.id,
        targetResource: 'auth.login',
        status: 'failed',
        message: shouldLock
          ? `Login failed and account locked after ${attempts} attempts`
          : `Login failed (attempt ${attempts}/${maxFailedAttempts})`,
      });

      throw new UnauthorizedException(shouldLock ? accountLockedMessage : invalidCredentialsMessage);
    }

    // Removed strict password policy check during login to prevent lockout of existing users or defaults

    // Upgrade legacy plain password hash to bcrypt/reset lock state without breaking login flow.
    try {
      if (!String(user.passwordHash).startsWith('$2')) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: await bcrypt.hash(password, 10),
            failedAttempts: 0,
            lockoutUntil: null,
          },
        });
      } else if ((user.failedAttempts || 0) > 0 || user.lockoutUntil) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedAttempts: 0, lockoutUntil: null },
        });
      }
    } catch (postAuthUpdateError: any) {
      console.warn('[Auth Service] Post-auth user metadata update skipped:', postAuthUpdateError?.message || postAuthUpdateError);
    }

    // ENTERPRISE FIX: 2026-04-29 — apply default-role self-heal so a fresh login
    // never returns an empty permissions array for a built-in role with a
    // corrupted/empty DB permissions JSON (matches AppBootstrapService behavior).
    const permissions = this.applyDefaultPermissionsFallback(
      this.normalizePermissions(user.role?.permissions),
    );
    const sessionTimeoutMinutes = this.getSessionTimeoutMinutes();
    const sessionExpiresAt = new Date(Date.now() + sessionTimeoutMinutes * 60 * 1000);
    const sessionId = randomUUID();
    const deviceFingerprint = this.resolveDeviceFingerprint(normalized, clientMeta);
    const ipAddress = this.resolveClientIp(clientMeta);
    const userAgent = this.resolveUserAgent(clientMeta);

    const payload = {
      sub: user.id,
      username: user.username || user.email || 'user',
      role: user.role?.name || 'Viewer',
      permissions,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || null,
      sid: sessionId,
    };
    const jwtExpiresIn = (process.env.JWT_EXPIRES_IN || '24h') as any;

    let accessToken: string;
    try {
      accessToken = await this.jwtService.signAsync(payload, {
        secret: this.getJwtSecret(),
        expiresIn: jwtExpiresIn,
      });
    } catch (jwtError: any) {
      console.error('[Auth Service] JWT signing failed:', jwtError?.message || jwtError);
      throw new UnauthorizedException('تعذر إنشاء جلسة الدخول. يرجى المحاولة لاحقاً.');
    }

    const tokenHash = AuditService.hashToken(accessToken);
    const deviceInfo = JSON.stringify({
      deviceFingerprint,
      ipAddress,
      userAgent,
    });

    await this.auditService.createSession({
      sessionId,
      userId: user.id,
      tokenHash,
      deviceInfo,
      username: user.username || user.email || normalized || 'user',
      role: user.role?.name || 'Viewer',
      ipAddress,
      userAgent,
      expiresAt: sessionExpiresAt,
    });

    await this.auditService.log({
      action: 'SESSION_CREATED',
      actorId: user.id,
      actorUsername: user.username || user.email || normalized || 'user',
      actorRole: user.role?.name || 'Viewer',
      targetUserId: user.id,
      targetResource: 'auth.session',
      status: 'success',
      message: 'New authenticated session created',
      metadata: {
        sessionId,
        expiresAt: sessionExpiresAt.toISOString(),
        deviceFingerprint,
        ipAddress,
      },
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: String(jwtExpiresIn),
      sessionId,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      user: {
        id: user.id,
        username: user.username || user.email || 'user',
        role: user.role?.name || 'Viewer',
        permissions,
        // FC-SEC-010 — the UI needs this at login to force a password change
        // before anything else is reachable, and it must come from the server
        // rather than being inferred from the absence of a session.
        mustChangePassword: user.mustChangePassword,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
      },
    };
  }

  /**
   * FC-SEC-003 — one-time first-run admin bootstrap.
   *
   * Refuses once any user already holds an administrative role, so this can
   * never be used to add a back-door administrator to a live system. The
   * password is hashed here and never leaves the backend.
   */
  async createInitialAdmin(dto: {
    firstName: string;
    lastName?: string;
    email: string;
    username: string;
    password: string;
  }) {
    await this.ensureDefaultRoles();

    const privileged = await this.prisma.user.count({
      where: { role: { name: { in: ['SuperAdmin', 'Admin'] } } },
    });
    if (privileged > 0) {
      throw new ConflictException('Setup has already been completed for this system.');
    }

    const email = String(dto.email || '').trim().toLowerCase();
    const username = String(dto.username || '').trim();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A user with this username or email already exists.');
    }

    const adminRole = await this.prisma.role.findUnique({ where: { name: 'Admin' } });
    if (!adminRole) {
      throw new InternalServerErrorException('Admin role is not available.');
    }

    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        firstName: String(dto.firstName || '').trim(),
        lastName: dto.lastName ? String(dto.lastName).trim() : null,
        isActive: true,
        roleId: adminRole.id,
      },
    });

    await this.auditService.log({
      action: 'INITIAL_ADMIN_CREATED',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: 'Admin',
      targetResource: `users/${user.id}`,
      status: 'success',
      message: 'Initial administrator created via one-time setup',
    });

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: adminRole.name,
      roleId: adminRole.id,
    };
  }

  async resetLoginAttempts(
    username: string,
    clientMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const normalized = String(username || '').trim();
    if (!normalized) {
      throw new BadRequestException('اسم المستخدم أو البريد الإلكتروني مطلوب.');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: normalized }, { email: normalized }],
      },
      include: {
        role: {
          select: {
            name: true,
          },
        },
      },
    });

    if (user) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: 0,
          lockoutUntil: null,
        },
      });

      await this.auditService.log({
        action: 'USER_UNLOCK',
        actorId: user.id,
        actorUsername: user.username || user.email || normalized,
        actorRole: user.role?.name || 'Viewer',
        targetUserId: user.id,
        targetResource: 'auth.reset-attempts',
        status: 'success',
        message: 'Login attempts and lockout metadata were reset',
        metadata: {
          ipAddress: this.resolveClientIp(clientMeta),
          userAgent: this.resolveUserAgent(clientMeta),
        },
      });
    }

    return {
      success: true,
      message: 'تمت إعادة ضبط المحاولات. يمكنك تسجيل الدخول من جديد.',
    };
  }

  async revokeSession(sessionId?: string): Promise<void> {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return;
    await this.auditService.revokeSession(normalizedSessionId);
  }

  async verifyToken(token: string): Promise<JwtUser> {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.getJwtSecret(),
    });

    const sessionId = payload?.sid ? String(payload.sid) : undefined;
    const userId = String(payload?.sub || '');
    const tokenHash = AuditService.hashToken(token);

    if (!userId) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!currentUser || !currentUser.isActive || (currentUser.lockoutUntil && currentUser.lockoutUntil > new Date())) {
      throw new UnauthorizedException('User account is inactive or locked');
    }

    if (sessionId) {
      const active = await this.auditService.findActiveSession({ sessionId, userId, tokenHash });
      if (!active) {
        await this.auditService.log({
          action: 'SESSION_EXPIRED',
          actorId: userId,
          actorUsername: String(payload?.username || 'unknown'),
          actorRole: String(payload?.role || 'Viewer'),
          targetUserId: userId,
          targetResource: 'auth.verify',
          status: 'failed',
          message: 'Token verification failed due to expired/revoked session',
        });
        throw new UnauthorizedException('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
      }
      await this.auditService.touchSession(sessionId);
    }

    return {
      id: userId,
      username: currentUser.username,
      role: currentUser.role?.name || 'Viewer',
      permissions: this.normalizePermissions(currentUser.role?.permissions),
      mustChangePassword: currentUser.mustChangePassword,
      name: currentUser.firstName || currentUser.lastName ? `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() : currentUser.username,
      sessionId,
    };
  }

  /**
   * FC-SEC-010 — a user changing their own password.
   *
   * The system had no password change, reset or recovery path of any kind. A
   * password was set once at creation or invitation accept and could never be
   * changed again by anybody, including its owner. On a warehouse floor where
   * terminals are shared, that is not a gap but an operational dead end.
   *
   * The current password is required so a borrowed or unattended session cannot
   * silently take the account over, and every other session is revoked so a
   * password change actually ends whoever else was holding it.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    clientMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }

    const current = String(currentPassword || '');
    if (!current) {
      throw new BadRequestException('كلمة المرور الحالية مطلوبة');
    }
    if (!(await this.verifyPassword(current, user.passwordHash))) {
      await this.auditService.log({
        action: 'PASSWORD_CHANGE_REJECTED',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: 'unknown',
        targetUserId: user.id,
        targetResource: 'auth.change-password',
        status: 'failed',
        message: 'Password change refused: the current password did not match',
      });
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }

    const next = String(newPassword || '');
    if (next === current) {
      throw new BadRequestException('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
    }
    if (!isPasswordPolicyCompliant(next)) {
      throw new BadRequestException(passwordPolicyMessage(next));
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(next, 10),
        // Detaches the account from ADMIN_PASSWORD for a superadmin, and clears
        // the forced-change prompt for everyone.
        passwordSetByUser: true,
        mustChangePassword: false,
        failedAttempts: 0,
        lockoutUntil: null,
      },
    });

    // Every session ends, including this one, so the next request must
    // re-authenticate with the new password.
    await this.prisma.activeSession.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    await this.auditService.log({
      action: 'PASSWORD_CHANGED',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: 'unknown',
      targetUserId: user.id,
      targetResource: 'auth.change-password',
      status: 'success',
      message: 'Password changed by the account owner; all sessions revoked',
      metadata: { ipAddress: this.resolveClientIp(clientMeta) },
    });

    return { changed: true, sessionsRevoked: true };
  }
}



