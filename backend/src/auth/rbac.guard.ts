// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_AUTHENTICATED_METADATA_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_METADATA_KEY,
  ROLES_METADATA_KEY,
} from './auth.constants';
import { isKnownPermission } from './permission-catalog';

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

    // FC-SEC-002: a route may only require permissions that exist in the catalog.
    const undefinedPermissions = requiredPermissions.filter(
      (permission) => !isKnownPermission(permission),
    );
    if (undefinedPermissions.length) {
      throw new ForbiddenException(
        `Route authorization metadata references unknown permission(s): ${undefinedPermissions.join(', ')}`,
      );
    }

    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(ROLES_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];
    const allowAuthenticated = this.reflector.getAllAndOverride<boolean>(ALLOW_AUTHENTICATED_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true;

    const request = context.switchToHttp().getRequest();
    const principal = this.resolvePrincipal(request);
    if (!principal) {
      throw new ForbiddenException('Missing authenticated principal for RBAC check');
    }

    if (allowAuthenticated) return true;

    if (!requiredPermissions.length && !requiredRoles.length) {
      throw new ForbiddenException('Route authorization metadata is required');
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

      // Only a shared-secret service token may act on the backup surface without
      // holding a backup.* grant, and only because it proved knowledge of
      // BACKUP_API_TOKEN / ADMIN_TOKEN. `type` is the discriminator that was
      // missing: the cookie path also lands here, and treating a session cookie
      // as a service token is what handed every signed-in user the whole backup
      // surface.
      if (String(backupActor.type || '') === 'system') {
        return { role, permissions: ['backup.*'] };
      }

      // Everyone else is authorized by what their role actually grants. An empty
      // list denies, which is the correct answer for an actor whose permissions
      // could not be established.
      const permissions = Array.isArray(backupActor.permissions)
        ? backupActor.permissions.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [];
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
