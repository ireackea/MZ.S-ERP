// ENTERPRISE FIX: Phase 5 - Final Production Readiness - 2026-03-05
// ENTERPRISE FIX: Multi-Source JWT Guard with Secure Fallback - 2026-03-04
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
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

type TokenSource = 'authorization' | 'cookie' | 'query';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly auditService = new AuditService();

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: unknown }>();
    const response = http.getResponse<Response>();
    const headers = request?.headers || {};

    const bearerToken = this.extractBearerToken(headers.authorization);
    const cookieToken = this.extractCookieToken(request);
    const queryToken = this.extractQueryToken(request);

    const tokenCandidates: Array<{ source: TokenSource; token: string }> = [];
    if (bearerToken) tokenCandidates.push({ source: 'authorization', token: bearerToken });
    if (cookieToken) tokenCandidates.push({ source: 'cookie', token: cookieToken });

    const allowQueryInCurrentEnv = this.allowQueryToken();
    if (queryToken && allowQueryInCurrentEnv) {
      tokenCandidates.push({ source: 'query', token: queryToken });
    } else if (queryToken && !allowQueryInCurrentEnv) {
      await this.logGuardAttempt(request, {
        status: 'failed',
        source: 'query',
        message: 'Query token rejected in production (DEV_MODE is not enabled)',
      });
    }

    if (tokenCandidates.length === 0) {
      throw new UnauthorizedException('Login required via secure cookie');
    }

    for (const candidate of tokenCandidates) {
      const authenticated = await this.tryAuthenticateCandidate(request, response, candidate.source, candidate.token);
      if (authenticated) {
        return true;
      }
    }

    throw new UnauthorizedException('Invalid or expired token');
  }

  private extractBearerToken(authHeader?: string): string {
    const header = String(authHeader || '');
    if (!header.startsWith('Bearer ')) return '';
    const token = header.slice(7).trim();
    if (!token) return '';
    if (!token.includes('.') || token.split('.').length !== 3) return '';
    return token;
  }

  private extractCookieToken(request: Request): string {
    const token = String(request?.cookies?.['feed_factory_jwt'] || '').trim();
    if (!token) return '';

    // Enforce secure transport for cookie-based auth in production.
    if (process.env.NODE_ENV === 'production') {
      const forwardedProto = String(request.headers['x-forwarded-proto'] || '').toLowerCase();
      const secureTransport = Boolean((request as any).secure) || forwardedProto === 'https';
      if (!secureTransport) return '';
    }
    return token;
  }

  private extractQueryToken(request: Request): string {
    const raw = (request?.query as any)?.token;
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private allowQueryToken(): boolean {
    if (process.env.NODE_ENV !== 'production') return true;
    return String(process.env.DEV_MODE || '').toLowerCase() === 'true';
  }

  private getJwtSecret(): string {
    return process.env.JWT_SECRET || process.env.ADMIN_TOKEN || 'feedfactory-dev-secret';
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
      const payload = await this.jwtService.verifyAsync<JwtPayloadLike>(expiredToken, {
        secret: this.getJwtSecret(),
        ignoreExpiration: true,
      });

      const userId = String(payload?.sub || '');
      const sessionId = String(payload?.sid || '');
      if (!userId || !sessionId) return false;

      const sessions = await this.auditService.listActiveSessions(userId);
      const activeSession = sessions.find((entry) => entry.id === sessionId);
      if (!activeSession) return false;

      const nextPayload = {
        sub: userId,
        username: String(payload?.username || ''),
        role: String(payload?.role || 'Viewer'),
        permissions: Array.isArray(payload?.permissions)
          ? payload.permissions.filter((entry): entry is string => typeof entry === 'string')
          : [],
        name: payload?.name ? String(payload.name) : null,
        sid: sessionId,
      };

      const refreshedToken = await this.jwtService.signAsync(nextPayload, {
        secret: this.getJwtSecret(),
        expiresIn: this.getJwtExpiresIn(),
      });

      if (source === 'cookie') {
        response.cookie('feed_factory_jwt', refreshedToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: 24 * 60 * 60 * 1000,
        });
      } else {
        response.setHeader('x-access-token', refreshedToken);
      }

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
          cookieSameSite: source === 'cookie' ? 'Strict' : undefined,
          cookieSecure: source === 'cookie' ? process.env.NODE_ENV === 'production' : undefined,
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
