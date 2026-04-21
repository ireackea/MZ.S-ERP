import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppBootstrapService } from './app-bootstrap.service';

@UseGuards(JwtAuthGuard)
@Controller('app')
export class AppBootstrapController {
  constructor(private readonly appBootstrapService: AppBootstrapService) {}

  @Get('bootstrap')
  async getBootstrap(@Req() req: any) {
    return this.appBootstrapService.getBootstrapPayload(req?.user || null);
  }
}