import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { TransactionService } from './transaction.service';
import { ComputedBalancesDto } from './dto/computed-balances.dto';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('balances')
export class BalancesController {
  constructor(private readonly transactionService: TransactionService) {}

  @Permissions('transactions.view')
  @Get('computed')
  async getComputedBalances(@Query() query: ComputedBalancesDto) {
    return this.transactionService.getComputedBalances(query.financialYear);
  }
}
