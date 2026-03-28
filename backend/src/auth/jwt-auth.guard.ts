// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// ENTERPRISE FIX: Phase 0.2 – Full Runtime Docker Proof - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { IS_PUBLIC_KEY } from './auth.constants';
import { AuthService } from './auth.service';

type JwtPayloadLike = {
  sub?: string;
  username?: string;
  role?: string;
  permissions?: string[];
  name?: string | null;
  sid?: string;
};

type TokenSource = 'cookie';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly auditService: AuditService;

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.auditService = new AuditService(this.prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: unknown }>();
    const response = http.getResponse<Response>();
    const cookieToken = this.extractCookieToken(request);

    if (!cookieToken) {
      throw new UnauthorizedException('Login required via secure cookie');
    }

    const authenticated = await this.tryAuthenticateCandidate(request, response, 'cookie', cookieToken);
    if (authenticated) {
      return true;
    }

    throw new UnauthorizedException('Invalid or expired token');
  }

  private extractCookieToken(request: Request): string {
    const token = String(request?.cookies?.['feed_factory_jwt'] || '').trim();
    if (!token) return '';

    // Enforce secure transport only when the cookie policy requires it.
    if (this.shouldUseSecureCookie(request)) {
      const forwardedProto = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
      const secureTransport = Boolean((request as any).secure) || forwardedProto === 'https';
      if (!secureTransport) return '';
    }
    return token;
  }

  private shouldUseSecureCookie(request: Request): boolean {
    const explicitSetting = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase();
    if (explicitSetting === 'true') return true;
    if (explicitSetting === 'false') return false;
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
    return Boolean((request as any).secure) || forwardedProto === 'https';
  }

  private getJwtSecret(): string {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    return secret;
  }

  private getJwtExpiresIn(): NonNullable<SignOptions['expiresIn']> {
    const raw = String(process.env.JWT_EXPIRES_IN || '24h').trim();
    if (/^\d+$/.test(raw)) {
      return Number(raw);
    }
    return raw as NonNullable<SignOptions['expiresIn']>;
  }

  private async tryAuthenticateCandidate(
    request: Request & { user?: unknown },
    response: Response,
    source: TokenSource,
    token: string,
  ): Promise<boolean> {
    await this.logGuardAttempt(request, {
      status: 'success',
      source,
      message: `JWT guard validation attempt started via ${source}`,
    });

    try {
      const user = await this.authService.verifyToken(token);
      request.user = user;
      await this.logGuardAttempt(request, {
        status: 'success',
        source,
        userId: String((user as any)?.id || ''),
        username: String((user as any)?.username || ''),
        role: String((user as any)?.role || 'Viewer'),
        message: `JWT validated successfully via ${source}`,
      });
      return true;
    } catch (error: any) {
      const isExpired = this.isTokenExpiredError(error);

      if (isExpired) {
        const refreshed = await this.tryRefreshExpiredToken(request, response, source, token);
        if (refreshed) return true;
      }

      await this.logGuardAttempt(request, {
        status: 'failed',
        source,
        message: `JWT validation failed via ${source}: ${this.normalizeErrorMessage(error)}`,
      });
      return false;
    }
  }

  private async tryRefreshExpiredToken(
    request: Request & { user?: unknown },
    response: Response,
    source: TokenSource,
    expiredToken: string,
  ): Promise<boolean> {
    try {
      // SECURITY FIX: 2026-03-28 - Verify token signature only (not expiration)
      // Then validate the session is still active before refreshing
      const payload = await this.jwtService.verifyAsync<JwtPayloadLike>(expiredToken, {
        secret: this.getJwtSecret(),
        ignoreExpiration: true, // Allow expired token for refresh flow only
      });

      const userId = String(payload?.sub || '');
      const sessionId = String(payload?.sid || '');
      if (!userId || !sessionId) return false;

      // SECURITY FIX: 2026-03-28 - Check if session is still valid before refreshing
      // This prevents refresh of revoked sessions
      const activeSession = await this.auditService.findActiveSession({
        sessionId,
        userId,
        tokenHash: AuditService.hashToken(expiredToken),
      });
      if (!activeSession) {
        await this.logGuardAttempt(request, {
          status: 'failed',
          source,
          message: 'Session not found or already revoked during refresh attempt',
        });
        return false;
      }

      // SECURITY FIX: 2026-03-28 - Re-validate user permissions from database
      // Don't trust permissions from the expired token
      const user = await this.prisma?.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });
      
      if (!user || !user.isActive) {
        await this.logGuardAttempt(request, {
          status: 'failed',
          source,
          userId,
          message: 'User not found or inactive during token refresh',
        });
        return false;
      }

      const freshPermissions = this.parsePermissions(user.role?.permissions);

      const nextPayload = {
        sub: userId,
        username: String(user.username || payload?.username || ''),
        role: String(user.role?.name || 'Viewer'),
        permissions: freshPermissions, // Use fresh permissions from DB
        name: user.firstName ? String(user.firstName) : null,
        sid: sessionId,
      };

      const refreshedToken = await this.jwtService.signAsync(nextPayload, {
        secret: this.getJwtSecret(),
        expiresIn: this.getJwtExpiresIn(),
      });

      const refreshedExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.auditService.rotateSessionToken(
        sessionId,
        AuditService.hashToken(refreshedToken),
        refreshedExpiresAt,
      );

      response.cookie('feed_factory_jwt', refreshedToken, {
        httpOnly: true,
        secure: this.shouldUseSecureCookie(request),
        sameSite: 'strict',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
      });

      const user = await this.authService.verifyToken(refreshedToken);
      request.user = user;

      await this.auditService.log({
        action: 'SESSION_EXTENDED',
        actorId: userId,
        actorUsername: String(payload?.username || 'unknown'),
        actorRole: String(payload?.role || 'Viewer'),
        targetUserId: userId,
        targetResource: 'auth.guard.refresh',
        status: 'success',
        message: `Expired token refreshed successfully via ${source}`,
        metadata: {
          source,
          sessionId,
          cookieSameSite: 'Strict',
          cookieSecure: this.shouldUseSecureCookie(request),
        },
      });

      return true;
    } catch (error) {
      await this.logGuardAttempt(request, {
        status: 'failed',
        source,
        message: `Refresh attempt failed via ${source}: ${this.normalizeErrorMessage(error)}`,
      });
      return false;
    }
  }

  private isTokenExpiredError(error: unknown): boolean {
    const message = this.normalizeErrorMessage(error).toLowerCase();
    return message.includes('jwt expired') || message.includes('expired');
  }

  private normalizeErrorMessage(error: unknown): string {
    if (!error) return 'unknown error';
    if (error instanceof Error) return error.message || 'error';
    return String(error);
  }

  private parsePermissions(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch {
      return [];
    }
  }

  private async logGuardAttempt(
    request: Request,
    details: {
      status: 'success' | 'failed';
      source: TokenSource;
      message: string;
      userId?: string;
      username?: string;
      role?: string;
    },
  ) {
    const actorId = details.userId || 'anonymous';
    const actorUsername = details.username || 'anonymous';
    const actorRole = details.role || 'Viewer';

    await this.auditService.log({
      action: 'PERMISSION_CHECK',
      actorId,
      actorUsername,
      actorRole,
      targetUserId: details.userId,
      targetResource: 'auth.jwt-guard',
      status: details.status,
      message: details.message,
      metadata: {
        source: details.source,
        method: request.method,
        path: request.originalUrl || request.url,
        ipAddress: String(request.ip || request.socket?.remoteAddress || '0.0.0.0'),
        userAgent: String(request.headers['user-agent'] || 'unknown'),
      },
    });
  }
}
