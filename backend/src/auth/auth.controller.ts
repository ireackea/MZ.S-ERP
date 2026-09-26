// ENTERPRISE FIX: Phase 0 – التنظيف الأساسي والأمان الحرج - 2026-03-13
// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import { Body, Controller, Get, Post, Req, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { CreateInitialAdminDto } from './dto/create-initial-admin.dto';
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
    // Only admins can reset login attempts for other users
    const requestingUser = req.user?.username;
    const isSelf = requestingUser === dto.username;
    const isAdmin = req.user?.role === 'SuperAdmin' || req.user?.role === 'Admin';
    
    if (!isSelf && !isAdmin) {
      return { 
        success: false, 
        message: 'You can only reset your own login attempts or must be an admin' 
      };
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
