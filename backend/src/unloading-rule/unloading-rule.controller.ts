import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { DeleteUnloadingRulesDto } from './dto/delete-unloading-rules.dto';
import { SaveUnloadingRuleDto } from './dto/save-unloading-rule.dto';
import { UnloadingRuleService } from './unloading-rule.service';

const hasPermission = (rawPermissions: unknown, permission: string) => {
  const permissions = Array.isArray(rawPermissions)
    ? rawPermissions.filter((entry): entry is string => typeof entry === 'string')
    : [];

  if (permissions.includes('*') || permissions.includes(permission)) {
    return true;
  }

  return permissions.some((granted) => {
    if (!granted.endsWith('.*')) {
      return false;
    }

    const prefix = granted.slice(0, -2);
    return permission === prefix || permission.startsWith(`${prefix}.`);
  });
};

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('unloading-rules')
export class UnloadingRuleController {
  constructor(private readonly unloadingRuleService: UnloadingRuleService) {}

  @Get()
  async findAll(@Req() req: any) {
    const permissions = req.user?.permissions;
    const includeInactive =
      hasPermission(permissions, 'settings.view.general') ||
      hasPermission(permissions, 'settings.update.system');

    return { data: await this.unloadingRuleService.findAll({ includeInactive }) };
  }

  @Permissions('settings.update.system')
  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: SaveUnloadingRuleDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return { data: await this.unloadingRuleService.create(dto, { userId, actorUsername }) };
  }

  @Permissions('settings.update.system')
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() dto: SaveUnloadingRuleDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return { data: await this.unloadingRuleService.update(id, dto, { userId, actorUsername }) };
  }

  @Permissions('settings.update.system')
  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async deleteMany(@Body() dto: DeleteUnloadingRulesDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    const actorUsername = req.user?.username;
    return this.unloadingRuleService.deleteMany(dto.ids, { userId, actorUsername });
  }
}