import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AllowAuthenticated } from '../auth/decorators/allow-authenticated.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { DeleteUnloadingRulesDto } from './dto/delete-unloading-rules.dto';
import { SaveUnloadingRuleDto } from './dto/save-unloading-rule.dto';
import { UnloadingRuleService } from './unloading-rule.service';
import { isPermissionGranted } from '../auth/permission-matching';

/**
 * Gate 5.1 - delegates to the shared matcher.
 *
 * The fourth copy of this logic. It is called with a role's raw permission array
 * to decide whether a caller may see deactivated unloading rules, so a divergence
 * from the guard's copy would reveal records to a role that cannot read them.
 */
const hasPermission = (rawPermissions: unknown, permission: string): boolean =>
  isPermissionGranted(
    Array.isArray(rawPermissions)
      ? rawPermissions.filter((entry): entry is string => typeof entry === 'string')
      : [],
    [permission],
  );

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('unloading-rules')
export class UnloadingRuleController {
  constructor(private readonly unloadingRuleService: UnloadingRuleService) {}

  @AllowAuthenticated()
  /**
   * Gate 4.3 - the real reference counts, so the settings screen stops guessing
   * from a truncated client store.
   */
  @Get('usage-counts')
  async usageCounts() {
    return this.unloadingRuleService.getUsageCounts();
  }

  // This route carried no gate, so the fail-closed refusal in `RbacGuard` answered
  // it with 403 before the handler ran — and the permission filtering the handler
  // does below never got the chance to apply. It is `@AllowAuthenticated()` because
  // that filtering is the design: any signed-in user reads the active rules, and only
  // `settings.view.general` / `settings.update.system` also see the retired ones.
  @AllowAuthenticated()
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