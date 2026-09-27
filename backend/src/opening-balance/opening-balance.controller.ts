import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { OpeningBalanceService } from './opening-balance.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { BulkUpdateBalanceDto } from './dto/bulk-update-balance.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('opening-balances')
export class OpeningBalanceController {
  constructor(private readonly service: OpeningBalanceService) {}

  @Permissions('opening-balances.create')
  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('Admin', 'SuperAdmin')
  create(@Body() dto: CreateOpeningBalanceDto, @Req() req: any) {
    // FC-SEC-011 — the author of a fiscal-year starting position is recorded.
    return this.service.setBalance(dto, this.actor(req));
  }

  @Permissions('opening-balances.view')
  @Get(':year')
  findAll(@Param('year') year: string) {
    return this.service.getBalancesByYear(Number(year));
  }

  @Permissions('opening-balances.bulk')
  @Roles('Admin', 'SuperAdmin')
  @Post('bulk')
  async bulk(@Body() dto: BulkUpdateBalanceDto, @Req() req: any) {
    return this.service.bulkUpsert(dto, this.actor(req));
  }

  private actor(req: any) {
    return {
      id: String(req?.user?.id || 'system'),
      username: String(req?.user?.username || 'system'),
      role: String(req?.user?.role || 'system'),
    };
  }
}
