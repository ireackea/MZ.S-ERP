// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Observable, Subject, map } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { BulkAssignRoleDto, BulkDeleteUsersDto } from './dto/bulk-actions.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { LockUserDto } from './dto/lock-user.dto';
import { UpdateRolePermissionsDto } from './dto/role-permissions.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type ActorContext = {
  id: string;
  username: string;
  role: string;
};

type UserAuditLog = {
  id: string;
  userId: string;
  actorId: string;
  actorUsername: string;
  actorRole: string;
  action: 'create' | 'update' | 'lock' | 'unlock' | 'delete' | 'role_permissions_update' | 'bulk_assign_role' | 'bulk_delete' | 'invite' | 'accept_invitation';
  details: string;
  timestamp: string;
};

type UserListRecord = Prisma.UserGetPayload<{
  include: {
    role: true;
  };
}>;

type RoleRecord = Prisma.RoleGetPayload<{}>;

@Injectable()
export class UsersService {
  private readonly updates$ = new Subject<{
    type: string;
    userId?: string;
    actorId?: string;
    timestamp: string;
  }>();
  private readonly invitationOutboxPath = path.resolve(process.cwd(), 'backups', 'invitation-emails-outbox.json');
  private readonly auditService: AuditService;

  constructor(private readonly prisma: PrismaService) {
    this.auditService = new AuditService(this.prisma);
  }

  stream(): Observable<MessageEvent> {
    return this.updates$.pipe(map((payload) => ({ data: payload } as MessageEvent)));
  }

  async listUsers(query: ListUsersDto) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(200, Number(query.limit || 20)));
    const where: Prisma.UserWhereInput = {};

    if (query.search) {
      const search = query.search.trim();
      if (search) {
        where.OR = [
          { username: { contains: search } },
          { email: { contains: search } },
          { firstName: { contains: search } },
          { lastName: { contains: search } },
        ];
      }
    }

    if (query.role) {
      where.role = { name: query.role };
    }

    if (query.status === 'active') where.isActive = true;
    if (query.status === 'locked') where.isActive = false;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: { role: true },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const response = {
      data: rows.map((row) => this.toUserDto(row)),
      total,
      page,
      limit,
    };

    await this.auditService.log({
      action: 'PERMISSION_CHECK',
      actorId: 'system',
      actorUsername: 'system',
      actorRole: 'system',
      targetResource: 'users.list',
      status: 'success',
      message: `Listed users page=${page} limit=${limit}`,
      metadata: { total },
    });

    return response;
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    await this.auditService.log({
      action: 'PERMISSION_CHECK',
      actorId: 'system',
      actorUsername: 'system',
      actorRole: 'system',
      targetResource: 'roles.list',
      status: 'success',
      message: `Listed roles count=${roles.length}`,
      metadata: { count: roles.length },
    });
    return roles.map((role) => this.toRoleDto(role));
  }

  // ENTERPRISE FIX: Phase 2 - Multi-User Sync & Unified User Management - 2026-03-02
  // SECURITY FIX: 2026-03-28 - Added permission validation for role management
  async createRole(dto: { name: string; description?: string; color?: string; permissions?: string[] }, actor?: ActorContext) {
    const exists = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (exists) {
      throw new BadRequestException('Role name already exists');
    }
    
    // SECURITY FIX: 2026-03-28 - Validate permissions don't include dangerous wildcards
    const requestedPermissions = dto.permissions || [];
    const hasWildcard = requestedPermissions.includes('*');
    
    if (hasWildcard && actor?.role?.toLowerCase() !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can create roles with wildcard (*) permissions');
    }
    
    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description || '',
        color: dto.color || '#64748b',
        permissions: JSON.stringify(requestedPermissions),
      },
    });
    return this.toRoleDto(role);
  }

  async createUser(dto: CreateUserDto, actor: ActorContext) {
    const role = await this.resolveRole(dto.roleId, dto.roleName);
    const username = dto.username.trim();

    if (!username) {
      throw new BadRequestException('username is required');
    }

    const user = await this.prisma.user.create({
      data: {
        username,
        email: dto.email?.trim() || null,
        passwordHash: await bcrypt.hash(dto.password, 10),
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
        isActive: dto.isActive ?? true,
        roleId: role.id,
      },
      include: { role: true },
    });

    await this.writeAudit({
      userId: user.id,
      actor,
      action: 'create',
      details: `Created user ${user.username} with role ${role.name}`,
    });
    await this.auditService.log({
      action: 'USER_CREATE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetUserId: user.id,
      targetResource: 'users',
      status: 'success',
      message: `Created user ${user.username}`,
      metadata: { role: role.name },
    });
    this.publish('user.created', user.id, actor.id);

    return this.toUserDto(user);
  }

  async inviteUser(dto: InviteUserDto, actor: ActorContext) {
    const role = await this.resolveRole(dto.roleId, dto.roleName);
    const email = String(dto.email || '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('email is required');
    }

    const expiresInMinutes = Math.max(15, Math.min(60 * 24 * 14, Number(dto.expiresInMinutes || 60 * 24)));
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const token = randomBytes(32).toString('hex');

    const usernameBase = email.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '') || 'invited_user';
    const username = `${usernameBase}_${Date.now().toString().slice(-6)}`;

    const existing = await this.prisma.user.findFirst({ where: { email } });

    let userId: string;
    if (existing) {
      if (existing.isEmailConfirmed) {
        throw new BadRequestException('A confirmed user already exists for this email');
      }
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          roleId: role.id,
          inviteToken: token,
          inviteExpires: expiresAt,
          isActive: false,
        },
      });
      userId = updated.id;
    } else {
      const placeholder = await this.prisma.user.create({
        data: {
          username,
          email,
          passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
          firstName: null,
          lastName: null,
          isActive: false,
          isEmailConfirmed: false,
          roleId: role.id,
          inviteToken: token,
          inviteExpires: expiresAt,
        },
      });
      userId = placeholder.id;
    }

    const invitation = await this.createInvitation({
      email,
      token,
      roleId: role.id,
      invitedById: actor.id === 'unknown' ? null : actor.id,
      recipientUserId: userId,
      expiresAt,
    });

    const invitationLink = this.buildInvitationLink(token);
    await this.sendInvitationEmail({
      email,
      roleName: role.name,
      invitationLink,
      expiresAt: expiresAt.toISOString(),
      invitationId: invitation.id,
      requestedBy: actor.username,
    });

    await this.writeAudit({
      userId,
      actor,
      action: 'invite',
      details: `Invitation sent to ${email} with role ${role.name}`,
    });
    await this.auditService.log({
      action: 'INVITATION_SENT',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetUserId: userId,
      targetResource: 'invitations',
      status: 'success',
      message: `Invitation sent to ${email}`,
      metadata: { role: role.name, expiresAt: expiresAt.toISOString() },
    });

    this.publish('user.invited', userId, actor.id);
    return {
      sent: true,
      email,
      role: this.toRoleDto(role),
      expiresAt: expiresAt.toISOString(),
      invitationLink,
      invitationId: invitation.id,
    };
  }

  async getCurrentUserPermissions(principal: any) {
    const role = String(principal?.role || 'Viewer');
    const permissions = Array.isArray(principal?.permissions)
      ? principal.permissions.filter((entry: unknown): entry is string => typeof entry === 'string')
      : [];

    return {
      role,
      permissions,
    };
  }

  checkPermissions(grantedPermissions: string[], requiredPermissions: string[]) {
    if (!requiredPermissions.length) return true;
    if (grantedPermissions.includes('*')) return true;

    return requiredPermissions.every((requiredPermission) => {
      if (grantedPermissions.includes(requiredPermission)) return true;
      return grantedPermissions.some((grantedPermission) => {
        if (!grantedPermission.endsWith('.*')) return false;
        const prefix = grantedPermission.slice(0, -2);
        return requiredPermission === prefix || requiredPermission.startsWith(`${prefix}.`);
      });
    });
  }

  async verifyInvitationToken(token: string) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new BadRequestException('token is required');

    const invitation = await this.prisma.invitation.findFirst({
      where: { token: cleanToken },
      include: { role: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (invitation.status === 'accepted' || invitation.acceptedAt) {
      throw new BadRequestException('Invitation already accepted');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invitation has expired');
    }

    return {
      valid: true,
      email: invitation.email,
      role: this.toRoleDto(invitation.role),
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const token = String(dto.token || '').trim();
    if (!token) throw new BadRequestException('token is required');

    const invitation = await this.prisma.invitation.findFirst({
      where: { token },
      include: { role: true, recipientUser: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    if (invitation.status === 'accepted' || invitation.acceptedAt) {
      throw new BadRequestException('Invitation already accepted');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Invitation has expired');
    }

    const user = invitation.recipientUser;
    if (!user) {
      throw new NotFoundException('Invitation user is missing');
    }

    const requestedUsername = dto.username?.trim();
    if (requestedUsername && requestedUsername !== user.username) {
      const usernameExists = await this.prisma.user.findFirst({ where: { username: requestedUsername } });
      if (usernameExists) throw new BadRequestException('username already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      include: { role: true },
      data: {
        username: requestedUsername || user.username,
        firstName: dto.firstName?.trim() || user.firstName,
        lastName: dto.lastName?.trim() || user.lastName,
        passwordHash: await bcrypt.hash(dto.password, 10),
        isActive: true,
        isEmailConfirmed: true,
        inviteToken: null,
        inviteExpires: null,
      },
    });

    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
      },
    });

    await this.writeAudit({
      userId: updated.id,
      actor: {
        id: updated.id,
        username: updated.username,
        role: updated.role.name,
      },
      action: 'accept_invitation',
      details: `Invitation accepted for ${updated.email || updated.username}`,
    });
    await this.auditService.log({
      action: 'INVITATION_ACCEPTED',
      actorId: updated.id,
      actorUsername: updated.username,
      actorRole: updated.role.name,
      targetUserId: updated.id,
      targetResource: 'invitations',
      status: 'success',
      message: `Invitation accepted for ${updated.email || updated.username}`,
    });

    this.publish('user.invitation.accepted', updated.id, updated.id);
    return {
      accepted: true,
      user: this.toUserDto(updated),
    };
  }

  async updateUser(id: string, dto: UpdateUserDto, actor: ActorContext) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    if (existing.role.name.toLowerCase() === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can update SuperAdmin account');
    }

    let roleId: string | undefined;
    if (dto.roleId || dto.roleName) {
      const role = await this.resolveRole(dto.roleId, dto.roleName);
      roleId = role.id;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        username: dto.username?.trim(),
        email: dto.email === undefined ? undefined : dto.email?.trim() || null,
        firstName: dto.firstName === undefined ? undefined : dto.firstName?.trim() || null,
        lastName: dto.lastName === undefined ? undefined : dto.lastName?.trim() || null,
        isActive: dto.isActive,
        roleId,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
      },
      include: { role: true },
    });

    await this.writeAudit({
      userId: updated.id,
      actor,
      action: 'update',
      details: `Updated user ${updated.username}`,
    });
    await this.auditService.log({
      action: 'USER_UPDATE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetUserId: updated.id,
      targetResource: 'users',
      status: 'success',
      message: `Updated user ${updated.username}`,
    });
    this.publish('user.updated', updated.id, actor.id);

    return this.toUserDto(updated);
  }

  async deleteUser(id: string, actor: ActorContext) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    if (existing.role.name.toLowerCase() === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can delete SuperAdmin account');
    }

    await this.prisma.user.delete({ where: { id } });

    await this.writeAudit({
      userId: id,
      actor,
      action: 'delete',
      details: `Deleted user ${existing.username}`,
    });
    await this.auditService.log({
      action: 'USER_DELETE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetUserId: id,
      targetResource: 'users',
      status: 'success',
      message: `Deleted user ${existing.username}`,
    });
    this.publish('user.deleted', id, actor.id);

    return { deleted: true, id };
  }

  async setLockStatus(id: string, dto: LockUserDto, actor: ActorContext) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    const targetRole = existing.role.name.toLowerCase();
    const locked = dto.locked !== false;

    if (!locked && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can unlock accounts');
    }
    if (targetRole === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can lock SuperAdmin');
    }

    const durationMinutes = Math.max(1, Number(dto.durationMinutes || 60 * 24));
    const lockoutUntil = locked ? new Date(Date.now() + durationMinutes * 60 * 1000) : null;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isActive: !locked,
        lockoutUntil,
        failedAttempts: locked ? existing.failedAttempts : 0,
      },
      include: { role: true },
    });

    await this.writeAudit({
      userId: id,
      actor,
      action: locked ? 'lock' : 'unlock',
      details: locked
        ? `Locked account for ${durationMinutes} minute(s). reason=${dto.reason || 'n/a'}`
        : 'Unlocked account',
    });
    await this.auditService.log({
      action: locked ? 'USER_LOCK' : 'USER_UNLOCK',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetUserId: id,
      targetResource: 'users.lock',
      status: 'success',
      message: locked
        ? `Locked account for ${durationMinutes} minute(s)`
        : 'Unlocked account',
      metadata: { reason: dto.reason || 'n/a' },
    });
    this.publish(locked ? 'user.locked' : 'user.unlocked', id, actor.id);

    return this.toUserDto(updated);
  }

  async getAuditLog(userId: string, limit = 200) {
    const take = Math.max(1, Math.min(1000, Number(limit || 200)));
    const entries = await this.auditService.listLogs({ limit: take * 3 });

    return entries
      .filter((entry) => entry.targetUserId === userId)
      .map((entry) => this.toUserAuditLog(entry, userId))
      .filter((entry): entry is UserAuditLog => Boolean(entry))
      .slice(0, take);
  }

  async updateRolePermissions(roleId: string, dto: UpdateRolePermissionsDto, actor: ActorContext) {
    const uniquePermissions = [...new Set((dto.permissions || []).map((permission) => String(permission).trim()).filter(Boolean))];
    const role = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        permissions: JSON.stringify(uniquePermissions),
        description: dto.description === undefined ? undefined : dto.description || null,
      },
    });

    await this.writeAudit({
      userId: roleId,
      actor,
      action: 'role_permissions_update',
      details: `Updated role permissions for ${role.name}`,
    });
    await this.auditService.log({
      action: 'ROLE_PERMISSIONS_UPDATE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetResource: `roles/${role.id}`,
      status: 'success',
      message: `Updated role permissions for ${role.name}`,
      metadata: { permissionCount: uniquePermissions.length },
    });
    this.publish('role.permissions.updated', undefined, actor.id);

    return this.toRoleDto(role);
  }

  async bulkAssignRole(dto: BulkAssignRoleDto, actor: ActorContext) {
    const role = await this.resolveRole(dto.roleId, undefined);
    const userIds = [...new Set((dto.userIds || []).map((id) => String(id).trim()).filter(Boolean))];
    if (!userIds.length) throw new BadRequestException('userIds is required');

    const result = await this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { roleId: role.id },
    });

    await this.writeAudit({
      userId: role.id,
      actor,
      action: 'bulk_assign_role',
      details: `Assigned role ${role.name} to ${result.count} user(s)`,
    });
    await this.auditService.log({
      action: 'BULK_ASSIGN_ROLE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetResource: `roles/${role.id}`,
      status: 'success',
      message: `Assigned role ${role.name} to ${result.count} user(s)`,
      metadata: { count: result.count },
    });
    this.publish('users.bulk.role_assigned', undefined, actor.id);

    return { updated: result.count, role: this.toRoleDto(role) };
  }

  async bulkDelete(dto: BulkDeleteUsersDto, actor: ActorContext) {
    const userIds = [...new Set((dto.userIds || []).map((id) => String(id).trim()).filter(Boolean))];
    if (!userIds.length) throw new BadRequestException('userIds is required');

    const targetUsers = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      include: { role: true },
    });

    if (!targetUsers.length) return { deleted: 0 };

    const actorRole = actor.role.toLowerCase();
    if (actorRole !== 'superadmin' && targetUsers.some((user) => user.role.name.toLowerCase() === 'superadmin')) {
      throw new ForbiddenException('Only SuperAdmin can bulk delete SuperAdmin accounts');
    }

    const result = await this.prisma.user.deleteMany({
      where: { id: { in: targetUsers.map((user) => user.id) } },
    });

    await this.writeAudit({
      userId: 'bulk',
      actor,
      action: 'bulk_delete',
      details: `Deleted ${result.count} user(s)`,
    });
    await this.auditService.log({
      action: 'BULK_DELETE_USERS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetResource: 'users.bulk.delete',
      status: 'success',
      message: `Deleted ${result.count} user(s)`,
      metadata: { count: result.count },
    });
    this.publish('users.bulk.deleted', undefined, actor.id);

    return { deleted: result.count };
  }

  private toRoleDto(role: RoleRecord) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      color: role.color,
      permissions: role.permissions,
      permissionsList: this.parsePermissions(role.permissions),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private toUserDto(user: UserListRecord) {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: fullName || user.username,
      isActive: user.isActive,
      failedAttempts: user.failedAttempts,
      lockoutUntil: user.lockoutUntil,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roleId: user.roleId,
      role: this.toRoleDto(user.role),
    };
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

  private async resolveRole(roleId?: string, roleName?: string) {
    if (roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (role) return role;
      throw new BadRequestException('Role not found by roleId');
    }
    if (roleName) {
      const role = await this.prisma.role.findUnique({ where: { name: roleName } });
      if (role) return role;
      throw new BadRequestException('Role not found by roleName');
    }
    const fallback = await this.prisma.role.findUnique({ where: { name: 'Viewer' } });
    if (!fallback) throw new BadRequestException('Default role Viewer is missing');
    return fallback;
  }

  private publish(type: string, userId?: string, actorId?: string) {
    this.updates$.next({
      type,
      userId,
      actorId,
      timestamp: new Date().toISOString(),
    });
  }

  private buildInvitationLink(token: string) {
    const base = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/accept-invitation?token=${encodeURIComponent(token)}`;
  }

  private async createInvitation(params: {
    email: string;
    token: string;
    roleId: string;
    invitedById: string | null;
    recipientUserId: string;
    expiresAt: Date;
  }) {
    return this.prisma.invitation.create({
      data: {
        email: params.email,
        token: params.token,
        roleId: params.roleId,
        invitedById: params.invitedById,
        recipientUserId: params.recipientUserId,
        expiresAt: params.expiresAt,
        status: 'pending',
      },
    });
  }

  private async sendInvitationEmail(payload: {
    email: string;
    roleName: string;
    invitationLink: string;
    expiresAt: string;
    invitationId: string;
    requestedBy: string;
  }) {
    await this.writeInvitationOutbox({
      to: payload.email,
      subject: 'FeedFactory Pro - Invitation',
      roleName: payload.roleName,
      invitationLink: payload.invitationLink,
      expiresAt: payload.expiresAt,
      invitationId: payload.invitationId,
      requestedBy: payload.requestedBy,
    });
  }

  private async writeInvitationOutbox(payload: {
    to: string;
    subject: string;
    roleName: string;
    invitationLink: string;
    expiresAt: string;
    invitationId: string;
    requestedBy: string;
  }) {
    let current: any[] = [];
    try {
      const raw = await fs.readFile(this.invitationOutboxPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) current = parsed;
    } catch {
      current = [];
    }

    const next = [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        transport: 'outbox-json',
        ...payload,
      },
      ...current,
    ].slice(0, 5000);

    await fs.mkdir(path.dirname(this.invitationOutboxPath), { recursive: true });
    await fs.writeFile(this.invitationOutboxPath, JSON.stringify(next, null, 2), 'utf8');
  }

  private async writeAudit(params: {
    userId: string;
    actor: ActorContext;
    action: UserAuditLog['action'];
    details: string;
  }) {
    await this.auditService.log({
      action: this.mapLegacyAction(params.action),
      actorId: params.actor.id,
      actorUsername: params.actor.username,
      actorRole: params.actor.role,
      targetUserId: params.userId === 'bulk' ? undefined : params.userId,
      targetResource: 'users.audit',
      status: 'success',
      message: params.details,
    });
  }

  private toUserAuditLog(entry: Awaited<ReturnType<AuditService['listLogs']>>[number], userId: string): UserAuditLog | null {
    const action = this.mapAuditActionToUserAction(entry.action);
    if (!action) return null;

    return {
      id: entry.id,
      userId,
      actorId: entry.actorId,
      actorUsername: entry.actorUsername,
      actorRole: entry.actorRole,
      action,
      details: entry.message,
      timestamp: entry.timestamp,
    };
  }

  private mapAuditActionToUserAction(action: string): UserAuditLog['action'] | null {
    switch (action) {
      case 'USER_CREATE':
        return 'create';
      case 'USER_UPDATE':
        return 'update';
      case 'USER_LOCK':
        return 'lock';
      case 'USER_UNLOCK':
        return 'unlock';
      case 'USER_DELETE':
        return 'delete';
      case 'ROLE_PERMISSIONS_UPDATE':
        return 'role_permissions_update';
      case 'BULK_ASSIGN_ROLE':
        return 'bulk_assign_role';
      case 'BULK_DELETE_USERS':
        return 'bulk_delete';
      case 'INVITATION_SENT':
        return 'invite';
      case 'INVITATION_ACCEPTED':
        return 'accept_invitation';
      default:
        return null;
    }
  }

  private mapLegacyAction(action: UserAuditLog['action']) {
    switch (action) {
      case 'create':
        return 'USER_CREATE' as const;
      case 'update':
        return 'USER_UPDATE' as const;
      case 'delete':
        return 'USER_DELETE' as const;
      case 'lock':
        return 'USER_LOCK' as const;
      case 'unlock':
        return 'USER_UNLOCK' as const;
      case 'role_permissions_update':
        return 'ROLE_PERMISSIONS_UPDATE' as const;
      case 'bulk_assign_role':
        return 'BULK_ASSIGN_ROLE' as const;
      case 'bulk_delete':
        return 'BULK_DELETE_USERS' as const;
      case 'invite':
        return 'INVITATION_SENT' as const;
      case 'accept_invitation':
        return 'INVITATION_ACCEPTED' as const;
      default:
        return 'PERMISSION_CHECK' as const;
    }
  }
}

