import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  // Req مُضاف لاستخراج هوية منفّذ العملية من الـ JWT token وتمريرها لسجل التدقيق
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { BulkCreateTransactionsDto, CreateTransactionDto } from './dto/create-transaction.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { DeleteTransactionsDto } from './dto/delete-transactions.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { MigrateFromLocalDto } from './dto/migrate-from-local.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionService } from './transaction.service';
import { resolveWarehouseScope } from '../common/scope';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Permissions('transactions.view')
  @Get()
  async list(@Query() query: ListTransactionsDto, @Req() req: any) {
    return this.transactionService.list(query, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.view')
  @Get(':id')
  async getById(@Param('id') id: string, @Req() req: any) {
    return this.transactionService.getById(id, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.create')
  @Post()
  async create(
    @Body() dto: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.createOne(dto, req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.adjust')
  @Roles('Admin', 'SuperAdmin')
  @Post('stock-adjustments')
  async createStockAdjustment(
    @Body() dto: StockAdjustmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.createStockAdjustment(
      dto,
      req.user?.sub || req.user?.id,
      req.user?.username,
      idempotencyKey,
      resolveWarehouseScope(req.user?.role),
    );
  }

  @Permissions('transactions.create')
  @Post('bulk')
  async createBulk(
    @Body() dto: BulkCreateTransactionsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.createMany(dto.transactions || [], req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.create')
  @Post('bulk-import')
  async bulkImport(
    @Body() dto: BulkCreateTransactionsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.createMany(dto.transactions || [], req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.migrate')
  @Roles('Admin', 'SuperAdmin')
  @Post('migrate-from-local')
  async migrateFromLocal(
    @Body() dto: MigrateFromLocalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.migrateFromLocal(
      dto.transactions || [],
      req.user?.sub || req.user?.id,
      req.user?.username,
      idempotencyKey,
      resolveWarehouseScope(req.user?.role),
    );
  }

  @Permissions('transactions.update')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.updateById(id, dto, req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.update')
  @Put(':id')
  async replace(
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.updateById(id, dto, req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.delete')
  @Delete(':id')
  async deleteById(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.deleteOne(id, req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }

  @Permissions('transactions.delete')
  @Post('delete')
  async delete(
    @Body() dto: DeleteTransactionsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionService.deleteMany(dto, req.user?.sub || req.user?.id, req.user?.username, idempotencyKey, resolveWarehouseScope(req.user?.role));
  }
}
