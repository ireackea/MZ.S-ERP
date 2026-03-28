// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_METADATA_KEY,
  ROLES_METADATA_KEY,
} from './auth.constants';

type Principal = {
  role: string;
  permissions: string[];
};

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(ROLES_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (!requiredPermissions.length && !requiredRoles.length) return true;

    const request = context.switchToHttp().getRequest();
    const principal = this.resolvePrincipal(request);
    if (!principal) {
      throw new ForbiddenException('Missing authenticated principal for RBAC check');
    }

    if (!this.hasRole(principal.role, requiredRoles)) {
      throw new ForbiddenException('Insufficient role');
    }

    if (!this.hasPermission(principal.permissions, requiredPermissions)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }

  private resolvePrincipal(request: any): Principal | null {
    const user = request?.user;
    if (user) {
      const role = String(user.role || 'Viewer');
      const permissions = Array.isArray(user.permissions)
        ? user.permissions.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [];
      return { role, permissions };
    }

    const backupActor = request?.backupActor;
    if (backupActor) {
      const role = String(backupActor.role || 'system');
      // Legacy backup tokens can only operate backup endpoints.
      const permissions = ['backup.*'];
      return { role, permissions };
    }

    return null;
  }

  private hasRole(userRole: string, requiredRoles: string[]): boolean {
    if (!requiredRoles.length) return true;
    const normalizedRole = String(userRole || '').toLowerCase();
    if (normalizedRole === 'superadmin') return true;

    return requiredRoles.some((role) => String(role || '').toLowerCase() === normalizedRole);
  }

  private hasPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
    if (!requiredPermissions.length) return true;
    if (userPermissions.includes('*')) return true;

    return requiredPermissions.every((permission) => {
      if (userPermissions.includes(permission)) return true;
      return userPermissions.some((granted) => this.matchWildcard(granted, permission));
    });
  }

  private matchWildcard(grantedPermission: string, requiredPermission: string): boolean {
    if (!grantedPermission.endsWith('.*')) return false;
    const prefix = grantedPermission.slice(0, -2);
    return requiredPermission === prefix || requiredPermission.startsWith(`${prefix}.`);
  }
}
