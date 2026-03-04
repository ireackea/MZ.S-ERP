import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
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
  async getUserTheme(@Param('id') id: string) {
    const theme = await this.service.getUserTheme(id);
    return { theme };
  }

  @Permissions('theme.update')
  @Post('user/:id')
  async updateUserTheme(@Param('id') id: string, @Body() body: { theme: string }) {
    const user = await this.service.updateUserTheme(id, body.theme);
    return { success: true, theme: user.theme };
  }
}
