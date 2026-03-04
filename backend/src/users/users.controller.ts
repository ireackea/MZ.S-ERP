// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { BulkAssignRoleDto, BulkDeleteUsersDto } from './dto/bulk-actions.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { LockUserDto } from './dto/lock-user.dto';
import { UpdateRolePermissionsDto } from './dto/role-permissions.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('permissions/me')
  async getCurrentUserPermissions(@Req() req: any) {
    return this.usersService.getCurrentUserPermissions(req?.user || null);
  }

  @Permissions('users.view')
  @Get()
  async getUsers(@Query() query: ListUsersDto) {
    return this.usersService.listUsers(query);
  }

  @Permissions('users.view')
  @Get('roles')
  async getRoles() {
    return this.usersService.listRoles();
  }

  // ENTERPRISE FIX: Phase 2 - Multi-User Sync & Unified User Management - 2026-03-02
  @Permissions('users.create')
  @Post('roles')
  async createRole(@Body() dto: { name: string; description?: string; color?: string; permissions?: string[] }) {
    return this.usersService.createRole(dto);
  }

  @Permissions('users.update')
  @Put('roles/:id/permissions')
  async updateRolePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @Req() req: any,
  ) {
    return this.usersService.updateRolePermissions(id, dto, this.resolveActor(req));
  }

  @Permissions('users.view')
  @Sse('stream')
  stream() {
    return this.usersService.stream();
  }

  @Permissions('users.create')
  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.createUser(dto, this.resolveActor(req));
  }

  @Permissions('users.create')
  @Post('invite')
  async inviteUser(@Body() dto: InviteUserDto, @Req() req: any) {
    return this.usersService.inviteUser(dto, this.resolveActor(req));
  }

  @Public()
  @Post('invite/verify')
  async verifyInvitation(@Body() dto: { token: string }) {
    return this.usersService.verifyInvitationToken(String(dto?.token || ''));
  }

  @Public()
  @Post('invite/accept')
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.usersService.acceptInvitation(dto);
  }

  @Permissions('users.update')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    return this.usersService.updateUser(id, dto, this.resolveActor(req));
  }

  @Permissions('users.delete')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.usersService.deleteUser(id, this.resolveActor(req));
  }

  @Permissions('users.lock')
  @Post(':id/lock')
  async lockAccount(@Param('id') id: string, @Body() dto: LockUserDto, @Req() req: any) {
    return this.usersService.setLockStatus(id, dto, this.resolveActor(req));
  }

  @Permissions('users.update')
  @Post('bulk/assign-role')
  async bulkAssignRole(@Body() dto: BulkAssignRoleDto, @Req() req: any) {
    return this.usersService.bulkAssignRole(dto, this.resolveActor(req));
  }

  @Permissions('users.delete')
  @Post('bulk/delete')
  async bulkDelete(@Body() dto: BulkDeleteUsersDto, @Req() req: any) {
    return this.usersService.bulkDelete(dto, this.resolveActor(req));
  }

  @Permissions('users.audit')
  @Get(':id/audit')
  async getAuditLog(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.usersService.getAuditLog(id, Number(limit || 200));
  }

  private resolveActor(req: any) {
    return {
      id: String(req?.user?.id || 'unknown'),
      username: String(req?.user?.username || 'unknown'),
      role: String(req?.user?.role || 'Viewer'),
    };
  }
}

