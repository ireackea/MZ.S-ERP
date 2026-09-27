// ENTERPRISE FIX: Phase 0 – التنظيف الأساسي والأمان الحرج - 2026-03-13
// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import { Body, Controller, ForbiddenException, Get, Post, Req, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { CreateInitialAdminDto } from './dto/create-initial-admin.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetLoginAttemptsDto } from './dto/reset-login-attempts.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RbacGuard } from './rbac.guard';
import { AllowAuthenticated } from './decorators/allow-authenticated.decorator';
import { PERMISSION_CATALOG, PERMISSION_MODULES } from './permission-catalog';
import { resetGlobalRateLimit } from '../security/global-rate-limit';

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private shouldUseSecureCookie(request: Request) {
    const explicitSetting = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase();
    if (explicitSetting === 'true') return true;
    if (explicitSetting === 'false') return false;
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
    return Boolean((request as any).secure) || forwardedProto === 'https';
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto.username, dto.password, {
      ipAddress: String(req.ip || req.socket?.remoteAddress || '0.0.0.0'),
      userAgent: String(req.headers['user-agent'] || 'unknown'),
    });
    
    res.cookie('feed_factory_jwt', result.accessToken, {
      httpOnly: true,
      secure: this.shouldUseSecureCookie(req),
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, 
    });

    // Valid pseudo-token to satisfy frontend interface without storing JWT or a generic dummy
    return {
      accessToken: 'httpOnly',
      tokenType: 'Bearer',
      expiresIn: result.expiresIn,
      user: result.user
    };
  }

  @AllowAuthenticated()
  @Post('logout')
  async logout(
    @Req() req: Request & { user?: { sessionId?: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.revokeSession(req.user?.sessionId);
    res.clearCookie('feed_factory_jwt', {
      path: '/',
      httpOnly: true,
      secure: this.shouldUseSecureCookie(req),
      sameSite: 'strict',
    });
    return { success: true, message: 'Logged out successfully' };
  }

  // SECURITY FIX: 2026-03-28 - Removed @Public() decorator
  // This endpoint now requires authentication to prevent brute force bypass
  @AllowAuthenticated()
  @Post('reset-attempts')
  async resetAttempts(
    @Body() dto: ResetLoginAttemptsDto,
    @Req() req: Request & { user?: { username?: string; role?: string } },
  ) {
    // FC-SEC-014 — the role comparison was case-sensitive while every other check
    // in the codebase normalises with toLowerCase(), so a session carrying
    // "superadmin" instead of "SuperAdmin" was denied its own admin powers here
    // and only here.
    const requestingUser = req.user?.username;
    const actorRole = String(req.user?.role || '').toLowerCase();
    const isSelf = requestingUser === dto.username;
    const isAdmin = actorRole === 'superadmin' || actorRole === 'admin';

    // FC-SEC-014 — this returned 200 with success:false, so a caller who was
    // refused read the same status as one who succeeded and had to inspect the
    // body to tell. A refusal is a 403.
    if (!isSelf && !isAdmin) {
      throw new ForbiddenException(
        'You can only reset your own login attempts, or be an Admin to reset someone else\'s',
      );
    }
    
    const result = await this.authService.resetLoginAttempts(dto.username, {
      ipAddress: String(req.ip || req.socket?.remoteAddress || '0.0.0.0'),
      userAgent: String(req.headers['user-agent'] || 'unknown'),
    });

    resetGlobalRateLimit(req);
    return result;
  }

  @AllowAuthenticated()
  @Get('me')
  async me(@Req() req: Request & { user?: unknown }) {
    return req.user;
  }

  /**
   * FC-SEC-010 — the only way out of the password this system could not
   * previously change. Revokes every session, so the caller must sign in again
   * with the new password.
   */
  @AllowAuthenticated()
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    return this.authService.changePassword(
      String(req.user?.id || ''),
      dto.currentPassword,
      dto.newPassword,
      {
        ipAddress: String(req.ip || req.socket?.remoteAddress || '0.0.0.0'),
        userAgent: String(req.headers['user-agent'] || 'unknown'),
      },
    );
  }

  // FC-SEC-003 — one-time first-run admin bootstrap, server-side only.
  // Public because the system has no admin yet, but it self-disables as soon
  // as any administrative user exists, so it cannot be used to add a backdoor.
  @Public()
  @Post('setup')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async setup(@Body() dto: CreateInitialAdminDto) {
    return this.authService.createInitialAdmin(dto);
  }

  // FC-SEC-002 — the single permission catalog, so the frontend never keeps a
  // hand-maintained list that can drift from the backend.
  @AllowAuthenticated()
  @Get('permissions')
  permissionsCatalog() {
    return {
      modules: PERMISSION_MODULES,
      permissions: PERMISSION_CATALOG,
      total: PERMISSION_CATALOG.length,
    };
  }
}
