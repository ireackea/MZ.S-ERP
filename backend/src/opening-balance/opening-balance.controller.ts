import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
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
  create(@Body() dto: CreateOpeningBalanceDto) {
    return this.service.setBalance(dto);
  }

  @Permissions('opening-balances.view')
  @Get(':year')
  findAll(@Param('year') year: string) {
    return this.service.getBalancesByYear(Number(year));
  }

  @Permissions('opening-balances.bulk')
  @Roles('Admin', 'SuperAdmin')
  @Post('bulk')
  async bulk(@Body() dto: BulkUpdateBalanceDto) {
    return this.service.bulkUpsert(dto);
  }
}
