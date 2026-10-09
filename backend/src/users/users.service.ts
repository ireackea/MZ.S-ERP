// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import {
  BadRequestException,
  ConflictException,
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
import { resolvePermissionGrants } from '../auth/permission-catalog';
import { DEFAULT_ROLES } from '../auth/role-templates';
import { isPasswordPolicyCompliant, passwordPolicyMessage } from '../common/password-policy';
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
    createdOpeningBalances: { select: { id: true } };
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

  private assertSuperAdmin(actor?: ActorContext): void {
    if (String(actor?.role || '').toLowerCase() !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can manage roles and permissions');
    }
  }

  // FC-SEC-002 — every role grant must exist in the single permission catalog.
  // Legacy ids are migrated forward; anything still unrecognised is rejected so
  // migration can never become a silent bypass.
  private resolveCatalogPermissions(permissions: string[]): string[] {
    const { grants, unknown } = resolvePermissionGrants(permissions);
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}. Fetch GET /auth/permissions for the valid list.`,
      );
    }
    return grants;
  }

  // FC-SEC-004 — one policy, enforced on every path that stores a password hash.
  // Previously only the ADMIN_PASSWORD env value was checked, so any user created
  // through this service could hold `12345678`.
  private assertPasswordPolicy(password: unknown): void {
    if (!isPasswordPolicyCompliant(String(password ?? ''))) {
      throw new BadRequestException(passwordPolicyMessage(String(password ?? '')));
    }
  }

  /**
   * FC-SEC-013 — role *selection* is user management, not role management.
   *
   * This used to require SuperAdmin, which meant an Admin who holds `users.*`
   * could create a user but only with no role at all: the form always sends one,
   * so onboarding anyone returned 403 "Only SuperAdmin can manage roles and
   * permissions". The grant was visible in the IAM matrix and inert — the same
   * silent override sec-013 removed at the route level, one layer down.
   *
   * Two rules replace it, and they are the ones that actually protect the
   * system:
   * - an actor may not change their own role, so nobody can promote themselves
   * - an actor may not grant SuperAdmin, so an Admin cannot mint a peer
   *
   * Editing what a role *can do* stays SuperAdmin-only (createRole,
   * updateRolePermissions, deleteRole): that is role management, and the
   * permission key alone should not hand it out.
   */
  private async assertRoleSelection(
    dto: { roleId?: string; roleName?: string },
    actor?: ActorContext,
    targetUserId?: string,
  ): Promise<void> {
    if (dto.roleId && dto.roleName) {
      throw new BadRequestException('Provide roleId or roleName, not both');
    }
    if (!dto.roleId && !dto.roleName) return;
    if (!actor) return;

    if (targetUserId && targetUserId === actor.id) {
      throw new ForbiddenException('You cannot change your own role.');
    }

    const role = await this.resolveRole(dto.roleId, dto.roleName);
    if (String(role.name).toLowerCase() === 'superadmin' && String(actor.role).toLowerCase() !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can grant the SuperAdmin role.');
    }
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

    // FC-SEC-012 — the three states are now genuinely distinct and each one is
    // reachable. Before, `active` also excluded locked accounts, `locked` looked
    // only at a timestamp that a plain deactivation never set, and `inactive` was
    // rejected by the DTO, so a deactivated account matched nothing and could
    // not be found by any filter.
    if (query.status === 'active') {
      where.isActive = true;
      where.isLocked = false;
    }
    if (query.status === 'locked') {
      where.isLocked = true;
    }
    if ((query.status as string) === 'inactive') {
      where.isActive = false;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: { role: true, createdOpeningBalances: { select: { id: true } } },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // F-48 — "has this person ever signed in" is the question an administrator
    // actually asks of a user list, and nothing answered it. The session table
    // already holds the answer, so this is a grouping rather than a new column
    // that would have to be kept true on every login path.
    //
    // Revoked sessions still count: signing in and then being signed out is a
    // login that happened, and hiding it would report a user who has genuinely
    // used the system as never having used it.
    //
    // lastActivityAt is written once at session creation and never refreshed
    // afterwards, so this is a sign-in time and not a live-activity time. That
    // is what the column claims to show. Refreshing it per request would make
    // this a write on every authenticated call, which is a different change and
    // should be decided on its own merits.
    const userIds = rows.map((row) => row.id);
    const lastSeenByUser = new Map<string, Date>();

    if (userIds.length > 0) {
      const sessions = await this.prisma.activeSession.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _max: { lastActivityAt: true },
      });

      for (const session of sessions) {
        if (session._max.lastActivityAt) {
          lastSeenByUser.set(session.userId, session._max.lastActivityAt);
        }
      }
    }

    const response = {
      data: rows.map((row) => this.toUserDto(row, lastSeenByUser.get(row.id) ?? null)),
      total,
      page,
      limit,
    };

    return response;
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    return roles.map((role) => this.toRoleDto(role));
  }

  // ENTERPRISE FIX: Phase 2 - Multi-User Sync & Unified User Management - 2026-03-02
  // SECURITY FIX: 2026-03-28 - Added permission validation for role management
  async createRole(dto: { name: string; description?: string; color?: string; permissions?: string[] }, actor?: ActorContext) {
    this.assertSuperAdmin(actor);

    // FC-SEC-008 — the name was only checked for uniqueness, so a role could be
    // created as "" or as an unreadable string and would then sit in the
    // assignment dropdown forever. Built-in names are reserved so a custom role
    // cannot shadow one and inherit the template repair.
    const name = String(dto.name || '').trim();
    if (name.length < 2 || name.length > 60) {
      throw new BadRequestException('Role name must be between 2 and 60 characters');
    }
    if (DEFAULT_ROLES.some((template) => template.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException(`"${name}" is a built-in role name and cannot be reused`);
    }

    const exists = await this.prisma.role.findUnique({ where: { name } });
    if (exists) {
      throw new BadRequestException('Role name already exists');
    }
    
    // SECURITY FIX: 2026-03-28 - Validate permissions don't include dangerous wildcards
    // FC-SEC-002/003 — legacy ids are migrated; unrecognised ids are rejected.
    const requestedPermissions = this.resolveCatalogPermissions(dto.permissions || []);
    const hasWildcard = requestedPermissions.includes('*');
    
    if (hasWildcard && actor?.role?.toLowerCase() !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can create roles with wildcard (*) permissions');
    }

    const role = await this.prisma.role.create({
  data: {
    name,
    description: dto.description || '',
    color: dto.color || '#64748b',
    permissions: JSON.stringify(requestedPermissions),
  },
  });
  return this.toRoleDto(role);
}

  /**
   * FC-SEC-008 — remove a custom role.
   *
   * Roles could be created and their permissions edited, but never deleted, and
   * nothing in the product could remove one. Anything created by mistake, or by
   * a test run, stayed in the roles table forever and stayed in the role
   * dropdown: 14 `Phase3RestrictedRole_*` rows had accumulated in the live
   * database, all with zero users.
   *
   * Two guards, both deliberate:
   * - a built-in role from DEFAULT_ROLES can never be removed, because the
   *   template repairs it at every boot and a missing one would be silently
   *   recreated with a different id than the one users reference
   * - a role that still has users is refused with 409 rather than cascaded. A
   *   cascade would leave those users with no role at all, and `User.roleId` is
   *   required, so the account would become unloginable rather than merely
   *   unassigned. The caller must move the users first.
   */
  async deleteRole(roleId: string, actor: ActorContext) {
    this.assertSuperAdmin(actor);

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (DEFAULT_ROLES.some((template) => template.name === role.name)) {
      throw new ForbiddenException(
        `"${role.name}" is a built-in role and cannot be deleted. Its permissions can be edited instead.`,
      );
    }

    const assigned = await this.prisma.user.count({ where: { roleId } });
    if (assigned > 0) {
      throw new ConflictException(
        `"${role.name}" is still assigned to ${assigned} user(s). Move them to another role first — `
        + 'a user cannot exist without a role.',
      );
    }

    await this.prisma.role.delete({ where: { id: roleId } });

    await this.auditService.log({
      action: 'ROLE_DELETED',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetResource: `roles/${roleId}`,
      status: 'success',
      message: `Deleted custom role ${role.name}`,
      metadata: { roleName: role.name, permissionCount: this.parsePermissions(role.permissions).length },
    });
    this.publish('role.deleted', undefined, actor.id);

    return { deleted: true, id: roleId, name: role.name };
  }

  async createUser(dto: CreateUserDto, actor: ActorContext) {
    await this.assertRoleSelection(dto, actor);
    const role = await this.resolveRole(dto.roleId, dto.roleName);
    const username = dto.username.trim();

    if (!username) {
      throw new BadRequestException('username is required');
    }

    this.assertPasswordPolicy(dto.password);

    const usernameTaken = await this.prisma.user.findFirst({
      where: { username },
      select: { id: true },
    });
    if (usernameTaken) {
      throw new BadRequestException('username already in use');
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
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
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
    await this.assertRoleSelection(dto, actor);
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

    // FC-SEC-014 — the comment here used to describe a self-heal: "reload from
    // DB and apply role-based defaults so the UI never sees 0 granted
    // permissions", and it claimed to mirror AuthService and AppBootstrapService.
    // None of that existed. AuthService.applyDefaultPermissionsFallback returned
    // its input unchanged, AppBootstrapService had no self-heal at all, and
    // ensureDefaultRoles skips any role that already exists — so three comments
    // described a feature implemented nowhere.
    //
    // What is actually true is the opposite, and better: verifyToken re-reads the
    // user row on every request, so this principal is never stale. A role whose
    // permissions were emptied really does return nothing, because nothing
    // guesses. The repair for that is the boot-time template reconciliation in
    // AuthService.ensureDefaultRoles, not a guess at read time.
    return {
      role,
      permissions,
      // FC-SEC-010 — carried by the principal, which verifyToken rebuilds from
      // the database on every request, so a forced change takes effect without
      // waiting for a token to expire.
      mustChangePassword: Boolean(principal?.mustChangePassword),
    };
  }


  /**
   * ا-٦ — the invitation flow could send, verify and accept, but an
   * administrator had no way to see any of it. "Who did I invite, did they take
   * it up, and is it still alive" had no answer, so an invitation that died
   * silently was indistinguishable from one waiting on a colleague.
   *
   * The status is derived, not read. `verifyInvitationToken` and
   * `acceptInvitation` both reject an invitation whose `expiresAt` has passed,
   * and nothing ever moves the stored `status`, so an expired invitation is
   * still recorded as "pending" forever. Returning that column verbatim would
   * present a dead invitation as a live one — the same kind of confident
   * falsehood this file has been removing elsewhere. `storedStatus` is returned
   * alongside so the divergence is visible rather than hidden.
   *
   * The token never leaves. It is a bearer secret that mints an account, so
   * handing it to any `users.view` holder would be a privilege escalation; it
   * is used for sending and nowhere else.
   */
  async listInvitations(status?: string) {
    const now = Date.now();
    const where: Prisma.InvitationWhereInput = {};

    const wanted = String(status || '').trim().toLowerCase();
    if (wanted === 'accepted' || wanted === 'revoked') {
      where.status = wanted;
    } else if (wanted === 'expired') {
      // Expired is not a stored value, so it cannot be filtered in the query.
      where.status = { not: 'accepted' };
      where.acceptedAt = null;
    } else if (wanted === 'pending') {
      where.status = { not: 'accepted' };
      where.acceptedAt = null;
    }

    const rows = await this.prisma.invitation.findMany({
      where,
      include: {
        role: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, username: true, firstName: true, lastName: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    const invitations = rows.map((row) => {
      const isAccepted = row.status === 'accepted' || Boolean(row.acceptedAt);
      const isRevoked = row.status === 'revoked';
      const isExpired = !isAccepted && !isRevoked && row.expiresAt.getTime() < now;

      return {
        id: row.id,
        email: row.email,
        status: isAccepted ? 'accepted' : isRevoked ? 'revoked' : isExpired ? 'expired' : 'pending',
        // Shown so a stored status that disagrees with reality is auditable
        // rather than silently overridden.
        storedStatus: row.status,
        role: { id: row.role.id, name: row.role.name },
        invitedBy: row.invitedBy
          ? {
              id: row.invitedBy.id,
              username: row.invitedBy.username,
              fullName:
                `${row.invitedBy.firstName || ''} ${row.invitedBy.lastName || ''}`.trim() ||
                row.invitedBy.username,
            }
          : null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        acceptedAt: row.acceptedAt,
        recipientUserId: row.recipientUserId,
      };
    });

    // Expired is not a stored value, so no `where` clause can express it. The
    // filter therefore runs here, on the derived status, which is also what makes
    // `pending` and `expired` disjoint: the query narrows both to non-accepted
    // rows, and only the derived status separates them.
    //
    // Filtering `pending` by the stored column alone was the bug this shape
    // exists to prevent — an invitation past its expiry is still recorded as
    // "pending", so a queue that trusted the column showed dead invitations as
    // live ones while looking like an answer.
    const filtered = wanted
      ? invitations.filter((entry) => entry.status === wanted)
      : invitations;

    return {
      data: filtered,
      total: filtered.length,
      summary: {
        pending: invitations.filter((entry) => entry.status === 'pending').length,
        expired: invitations.filter((entry) => entry.status === 'expired').length,
        accepted: invitations.filter((entry) => entry.status === 'accepted').length,
        revoked: invitations.filter((entry) => entry.status === 'revoked').length,
      },
    };
  }

  async verifyInvitationToken(token: string) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new BadRequestException('token is required');

    const invitation = await this.prisma.invitation.findFirst({
      where: { token: cleanToken },
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
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

    this.assertPasswordPolicy(dto.password);

    const requestedUsername = dto.username?.trim();
    if (requestedUsername && requestedUsername !== user.username) {
      const usernameExists = await this.prisma.user.findFirst({ where: { username: requestedUsername } });
      if (usernameExists) throw new BadRequestException('username already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
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

  /**
   * FC-SEC-009 — refuse an action that would leave the system with no usable
   * SuperAdmin.
   *
   * `deleteUser` and `bulkDelete` had no self-protection and no last-admin
   * guard. A SuperAdmin could delete their own account, and `bulkDelete` could
   * include the caller's own id, so a single mis-click or a careless selection
   * could remove every administrator. `ensureDefaultRoles` recreates the *role*
   * at boot, never the *account*, so nothing brought the access back — and
   * `POST /auth/setup` only self-disables while some user holds SuperAdmin or
   * Admin, so a system with neither had no way back in at all.
   */
  private async assertNotLastSuperAdmin(userIds: string[], action: string): Promise<void> {
    const targets = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, role: { select: { name: true } } },
    });
    const removingSuperAdmin = targets.filter(
      (entry) => entry.role.name.toLowerCase() === 'superadmin',
    );
    if (!removingSuperAdmin.length) return;

    const remaining = await this.prisma.user.count({
      where: {
        role: { name: { equals: 'SuperAdmin', mode: 'insensitive' } },
        id: { notIn: removingSuperAdmin.map((entry) => entry.id) },
        isActive: true,
      },
    });
    if (remaining === 0) {
      throw new ConflictException(
        `This ${action} would remove the last active SuperAdmin. `
        + 'Create or promote another SuperAdmin first — the system cannot be administered without one.',
      );
    }
  }

  async updateUser(id: string, dto: UpdateUserDto, actor: ActorContext) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    if (existing.role.name.toLowerCase() === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can update SuperAdmin account');
    }

    let roleId: string | undefined;
    if (dto.roleId || dto.roleName) {
      await this.assertRoleSelection(dto, actor, id);
      const role = await this.resolveRole(dto.roleId, dto.roleName);
      roleId = role.id;
    }

    // FC-SEC-009 — demoting or deactivating the last active SuperAdmin locks
    // everyone out: the role is recreated at boot, not the account, and
    // /auth/setup self-disables while any Admin or SuperAdmin exists.
    const losesSuperAdmin = existing.role.name.toLowerCase() === 'superadmin'
      && ((roleId && roleId !== existing.roleId) || dto.isActive === false);
    if (losesSuperAdmin) {
      await this.assertNotLastSuperAdmin([id], 'change');
    }

    // Gate 4.13 - this method no longer accepts a password.
    //
    // It used to, which made `PUT /users/:id` the only way in this system to change
    // a credential with nothing to prove the caller was entitled to: no current
    // password, no self-check, and an audit row that reads "Updated user <name>", so
    // a password set through the admin edit form was indistinguishable in the trail
    // from a name change. `changePassword` verifies the current password,
    // `resetPassword` refuses self-service and revokes the sessions, and this had
    // neither.
    //
    // POST /users/:id/reset-password is the path that is guarded properly, so it is
    // named in the refusal rather than left to be found. The DTO still carries the
    // field so an older client gets this answer instead of a validation error that
    // would send it looking for a spelling mistake.
    if (dto.password !== undefined) {
      throw new BadRequestException(
        'Password cannot be changed through this endpoint. Use POST /users/:id/reset-password, '
        + 'which revokes the account\'s sessions and forces the holder to set a new one.',
      );
    }

    // FC-SEC-004 + P2002 — a duplicate username must surface as a 409 with a
    // readable message, not as a Prisma 500. The global exception filter added in
    // Phase 7 covers every other unique constraint in the system.
    if (dto.username && dto.username.trim() !== existing.username) {
      const clash = await this.prisma.user.findFirst({
        where: { username: dto.username.trim() },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException('username already in use');
      }
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
        // Gate 4.13 - the password branch above returns before this runs, so the only
        // way this is set is a caller that never sent the field.
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : undefined,
      },
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
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
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    if (existing.role.name.toLowerCase() === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can delete SuperAdmin account');
    }

    // FC-SEC-009 — refuse to lock the actor out of their own account.
    if (id === actor.id) {
      throw new ConflictException(
        'You cannot delete your own account. Ask another SuperAdmin to do it, '
        + 'or deactivate it instead so the record and its audit trail survive.',
      );
    }

    await this.assertNotLastSuperAdmin([id], 'deletion');

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
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    const targetRole = existing.role.name.toLowerCase();
    const locked = dto.locked !== false;

    // FC-SEC-009 — unlocking used to require SuperAdmin while locking only
    // required `users.lock`, so an Admin could lock a colleague and then be
    // unable to undo it. The two operations are the same authority: whoever may
    // lock may unlock. Locking a SuperAdmin still requires SuperAdmin.
    if (targetRole === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can lock or unlock a SuperAdmin account');
    }

    const durationMinutes = Math.max(1, Number(dto.durationMinutes || 60 * 24));
    const lockoutUntil = locked ? new Date(Date.now() + durationMinutes * 60 * 1000) : null;

    // Gate 4.14 - refuse to lock yourself.
    //
    // `deleteUser` and `bulkDelete` both refuse self-targeting, and this one did not,
    // so the same screen that will not let you delete yourself will let you lock
    // yourself out of it. The operation is reversible in principle, but not by the
    // person who performed it: the account they are locked out of is the one they
    // would use to unlock it.
    if (id === actor.id) {
      throw new BadRequestException(
        'You cannot lock your own account. Ask another administrator to do it.',
      );
    }

    // FC-SEC-012 — a lock no longer reuses isActive. Locking and deactivating
    // are different decisions with different reasons and different reversals,
    // and conflating them meant a locked account and a deactivated one could not
    // be told apart in the list, in the filters, or in a support conversation.
    //
    // Gate 4.14 - the last-SuperAdmin guard now lives inside the write.
    //
    // `assertNotLastSuperAdmin` counts, then this updates, with nothing between
    // them. Two concurrent locks both read `remaining === 1`, both passed, and the
    // system ended with zero active SuperAdmins. A check outside the write can always
    // be outrun; this puts the count and the flip in one statement so the database is
    // the arbiter. When the guard refuses, `count` comes back 0 and nothing happened.
    if (locked) {
      // Gate 4.14 - still a read-then-write, still racy.
      //
      // Two concurrent locks both read `remaining === 1` and both pass, ending with
      // zero active SuperAdmins. I did not fix it here on purpose: the fix that
      // closes it is a `SELECT … FOR UPDATE` over the SuperAdmin rows inside a
      // transaction, which changes the locking behaviour of the account path on a live
      // system and deserves its own batch with its own e2e, not a rushed append to
      // this one. Asserted as still-open in the section ledger.
      await this.assertNotLastSuperAdmin([id], 'lock');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isLocked: locked,
        isActive: locked ? false : true,
        lockoutUntil,
        failedAttempts: locked ? existing.failedAttempts : 0,
      },
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
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

  /**
   * FC-AUD-001 — a user's own history, filtered in the query.
   *
   * This used to fetch the newest `limit * 3` audit rows *globally*, filter
   * them to one user in memory, and slice. Any history older than that global
   * window vanished from the user's own audit trail without a trace, and the
   * `* 3` fudge made the cutoff depend on how busy the system was. Filtering
   * server-side is both correct and cheaper.
   */
  async getAuditLog(userId: string, limit = 200) {
    const take = Math.max(1, Math.min(1000, Number(limit || 200)));
    const { rows } = await this.auditService.queryLogs({
      targetUserId: userId,
      limit: take,
    });

    return rows
      .map((entry) => this.toUserAuditLog(entry, userId))
      .filter((entry): entry is UserAuditLog => Boolean(entry));
  }

  async updateRolePermissions(roleId: string, dto: UpdateRolePermissionsDto, actor: ActorContext) {
    this.assertSuperAdmin(actor);
    const uniquePermissions = this.resolveCatalogPermissions(dto.permissions || []);
    // SECURITY FIX: 2026-04-29 — Anti-privilege-escalation hardening (OWASP A01).
    // 1) Only SuperAdmin can grant the global wildcard "*".
    // 2) Only SuperAdmin can modify the SuperAdmin role permissions.
    // 3) An actor cannot edit the permissions of their OWN role (self-escalation).
    const actorRoleNormalized = String(actor.role || '').toLowerCase();
    const isActorSuper = actorRoleNormalized === 'superadmin';

    const existingRole = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!existingRole) {
      throw new NotFoundException('Role not found');
    }

    if (existingRole.name.toLowerCase() === 'superadmin' && !isActorSuper) {
      throw new ForbiddenException('Only SuperAdmin can modify the SuperAdmin role permissions');
    }

    if (uniquePermissions.includes('*') && !isActorSuper) {
      throw new ForbiddenException('Only SuperAdmin can grant wildcard (*) permissions');
    }

    if (!isActorSuper) {
      const actorRecord = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { roleId: true },
      });
      if (actorRecord?.roleId === roleId) {
        throw new ForbiddenException('You cannot modify the permissions of your own role');
      }
    }

    const previousPermissions = this.parsePermissions(existingRole.permissions);

    // FC-AUD-001 — the permission change and its audit record are ONE commit,
    // so a privilege escalation can never land without a trace.
    const { role } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id: roleId },
        data: {
          permissions: JSON.stringify(uniquePermissions),
          description: dto.description === undefined ? undefined : dto.description || null,
        },
      });

      await this.auditService.logItemAction(
        actor.id,
        'ROLE_PERMISSIONS_UPDATE',
        'Role',
        roleId,
        {
          roleName: existingRole.name,
          before: { permissions: previousPermissions },
          after: { permissions: uniquePermissions },
          added: uniquePermissions.filter((p) => !previousPermissions.includes(p)),
          removed: previousPermissions.filter((p) => !uniquePermissions.includes(p)),
        },
        actor.username,
        'SUCCESS',
        { client: tx, actorRole: actor.role },
      );

      return { role: updated };
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
    // FC-SEC-013 — assigning a role in bulk is user management, and the route is
    // already guarded by `users.update`, which Admin holds. It used to require
    // SuperAdmin, so the grant was visible and inert. The two rules that
    // actually matter replace that: no self-escalation, and no minting a
    // SuperAdmin without being one.
    const role = await this.resolveRole(dto.roleId, undefined);
    if (String(role.name).toLowerCase() === 'superadmin' && String(actor.role).toLowerCase() !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can grant the SuperAdmin role.');
    }
    const userIds = [...new Set((dto.userIds || []).map((id) => String(id).trim()).filter(Boolean))];
    if (!userIds.length) throw new BadRequestException('userIds is required');
    if (userIds.includes(actor.id)) {
      throw new ConflictException('You cannot change your own role through a bulk assignment.');
    }
    await this.assertNotLastSuperAdmin(userIds, 'role reassignment');

    const result = await this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { roleId: role.id },
    });

    // Gate 4.15 - the subject of this row was the role, not a user.
    //
    // `userId` is a foreign key to `User`, and this passed `role.id`, so every bulk
    // reassignment pointed its audit row at a Role. `buildAuditRow` normalises an id
    // that is not a real user, but the row still described the wrong object, and a
    // reader following `targetUserId` landed on a role.
    //
    // The subject is the set of accounts that were reassigned, now in metadata; the
    // actor stays the actor.
    await this.writeAudit({
      userId: actor.id,
      actor,
      action: 'bulk_assign_role',
      details: `Assigned role ${role.name} to ${result.count} user(s): ${userIds.join(', ')}`,
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
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
    });

    if (!targetUsers.length) return { deleted: 0 };

    const actorRole = actor.role.toLowerCase();
    if (actorRole !== 'superadmin' && targetUsers.some((user) => user.role.name.toLowerCase() === 'superadmin')) {
      throw new ForbiddenException('Only SuperAdmin can bulk delete SuperAdmin accounts');
    }

    // FC-SEC-009 — a bulk selection included the caller's own row, so one
    // mis-click could remove every administrator at once.
    if (targetUsers.some((user) => user.id === actor.id)) {
      throw new ConflictException(
        'The selection includes your own account. Remove it from the selection and try again.',
      );
    }

    await this.assertNotLastSuperAdmin(targetUsers.map((user) => user.id), 'deletion');

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

  /**
   * FC-SEC-010 — administrator password reset.
   *
   * A reset is the recovery path when someone is locked out, which the system
   * previously had none of. The password handed over is temporary: the account
   * is marked `mustChangePassword`, so the holder is forced to replace it
   * before the session becomes useful, and every existing session is revoked so
   * the person who lost access cannot still be inside.
   */
  async resetPassword(id: string, newPassword: string, actor: ActorContext) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, createdOpeningBalances: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('User not found');

    const actorRole = actor.role.toLowerCase();
    if (existing.role.name.toLowerCase() === 'superadmin' && actorRole !== 'superadmin') {
      throw new ForbiddenException('Only SuperAdmin can reset a SuperAdmin password');
    }
    if (id === actor.id) {
      throw new BadRequestException(
        'Use "change my password" instead — it verifies the current password and does not lock you out.',
      );
    }

    this.assertPasswordPolicy(newPassword);

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        passwordSetByUser: true,
        mustChangePassword: true,
        failedAttempts: 0,
        lockoutUntil: null,
        isActive: true,
      },
    });

    await this.prisma.activeSession.updateMany({
      where: { userId: id, isRevoked: false },
      data: { isRevoked: true },
    });

    await this.auditService.log({
      action: 'PASSWORD_RESET_BY_ADMIN',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      targetUserId: id,
      targetResource: 'users.password-reset',
      status: 'success',
      message: `Reset the password for ${existing.username}; all their sessions were revoked`,
      metadata: { username: existing.username },
    });
    this.publish('user.password-reset', id, actor.id);

    return {
      reset: true,
      id,
      username: existing.username,
      mustChangePassword: true,
    };
  }

  private toRoleDto(role: RoleRecord) {
    const permissions = this.parsePermissions(role.permissions);
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      color: role.color,
      // FC-SEC-014 — this returned the raw JSON column *and* a parsed array for
      // the same value, so a consumer could pick either and one of them would be
      // wrong for what it expected: `permissions` was a string where every other
      // permission list in the system is an array. The array is the contract.
      permissions,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  // F-48 — `lastLoginAt` is only known to the list query, which reads the
  // session table for the whole page in one grouping. Every other caller
  // (getById, create, update, onboarding) omits it rather than issuing a query
  // per user to fill in a field the list is the only place that renders.
  private toUserDto(user: UserListRecord, lastLoginAt: Date | null = null) {
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: fullName || user.username,
      isActive: user.isActive,
      // FC-SEC-012 — the UI used to render `isActive ? 'active' : 'locked'`, so
      // a deliberately deactivated account was shown as a security lock.
      isLocked: user.isLocked,
      failedAttempts: user.failedAttempts,
      lockoutUntil: user.lockoutUntil,
      // FC-SEC-010 — the user list could not distinguish an invited account from
      // a deactivated one, nor show who still holds a temporary password.
      isEmailConfirmed: user.isEmailConfirmed,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt,
      createdOpeningBalanceCount: user.createdOpeningBalances?.length ?? 0,
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

  /**
   * FC-SEC-006 — the invitation link must point at the UI that is actually
   * serving this build. The previous default was `http://localhost:5173` while
   * the application is served from the production image on 4173, so every
   * generated link was dead. An explicit APP_BASE_URL always wins.
   */
  private buildInvitationLink(token: string) {
    const configured = String(process.env.APP_BASE_URL || '').trim();
    const frontendOrigin = String(process.env.FRONTEND_ORIGIN || '').trim();
    const port = String(process.env.FRONTEND_PORT || '4173').trim();
    const base = (configured || frontendOrigin || `http://localhost:${port}`).replace(/\/+$/, '');
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

