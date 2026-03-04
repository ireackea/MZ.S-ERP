import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class BackupGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const normalizeHeader = (value: unknown): string | undefined => {
      if (Array.isArray(value)) return String(value[0] ?? '').trim() || undefined;
      if (value == null) return undefined;
      const raw = String(value).trim();
      return raw || undefined;
    };

    const bearer = normalizeHeader(request.get?.('authorization') || request.headers?.authorization);
    const bearerToken = bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : undefined;

    if (bearerToken) {
      try {
        const user = await this.authService.verifyToken(bearerToken);
        request.backupActor = {
          type: 'user',
          mode: 'manual',
          userId: user.id || undefined,
          username: user.username,
          role: user.role,
        };
        return true;
      } catch {
        // Fallback to backup token path.
      }
    }

    const token =
      normalizeHeader(request.get?.('x-backup-token')) ||
      normalizeHeader(request.get?.('x-admin-token')) ||
      normalizeHeader(request.headers?.['x-backup-token']) ||
      normalizeHeader(request.headers?.['x-admin-token']) ||
      normalizeHeader(request.headers?.['x-access-token']) ||
      bearerToken;

    const expectedTokens = [process.env.BACKUP_API_TOKEN, process.env.ADMIN_TOKEN]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    if (!expectedTokens.length) {
      throw new UnauthorizedException('Backup access token is not configured');
    }

    if (!token || !expectedTokens.includes(token)) {
      throw new UnauthorizedException('Invalid backup access token');
    }

    request.backupActor = {
      type: 'system',
      mode: 'manual',
      username: 'token-admin',
      role: 'admin',
    };

    return true;
  }
}
