import { Controller, Get, Param, Post, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { ThemeService } from './theme.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('theme')
export class ThemeController {
  constructor(private readonly service: ThemeService) {}

  @Permissions('theme.view')
  @Get('user/:id')
  async getUserTheme(@Param('id') id: string, @Req() req: any) {
    const theme = await this.service.getUserTheme(id, actorFrom(req));
    return { theme };
  }

  @Permissions('theme.update')
  @Post('user/:id')
  async updateUserTheme(@Param('id') id: string, @Body() body: { theme: string }, @Req() req: any) {
    const user = await this.service.updateUserTheme(id, body?.theme, actorFrom(req));
    return { success: true, theme: user.theme };
  }
}

/**
 * The caller, as the service needs it: an id to compare against the target account, and
 * the grant list to decide whether an administrator may act on someone else's.
 *
 * Read from `request.user` rather than passed down by the guard, because the guard is
 * what authenticates: a service that took its caller on trust would accept the same call
 * with the ownership check removed and nothing would notice.
 */
const actorFrom = (req: any): { id: string; permissions: string[] } => {
  const user = req?.user || {};
  return {
    id: String(user.id || user.sub || '').trim(),
    permissions: Array.isArray(user.permissions) ? user.permissions.filter((p: unknown) => typeof p === 'string') : [],
  };
};