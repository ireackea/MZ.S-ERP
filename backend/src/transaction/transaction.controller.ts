import {
  Body,
  Controller,
  Delete,
  Get,
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
import { DeleteTransactionsDto } from './dto/delete-transactions.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { MigrateFromLocalDto } from './dto/migrate-from-local.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionService } from './transaction.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Permissions('transactions.view')
  @Get()
  async list(@Query() query: ListTransactionsDto) {
    return this.transactionService.list(query);
  }

  @Permissions('transactions.view')
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.transactionService.getById(id);
  }

  @Permissions('transactions.create')
  @Post()
  async create(@Body() dto: CreateTransactionDto, @Req() req: any) {
    // req.user محقون من JwtAuthGuard — sub هو userId ويُستخدم في سجل التدقيق
    return this.transactionService.createOne(dto, req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('transactions.create')
  @Post('bulk')
  async createBulk(@Body() dto: BulkCreateTransactionsDto, @Req() req: any) {
    return this.transactionService.createMany(dto.transactions || [], req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('transactions.create')
  @Post('bulk-import')
  async bulkImport(@Body() dto: BulkCreateTransactionsDto, @Req() req: any) {
    return this.transactionService.createMany(dto.transactions || [], req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('transactions.migrate')
  @Roles('Admin', 'SuperAdmin')
  @Post('migrate-from-local')
  async migrateFromLocal(@Body() dto: MigrateFromLocalDto) {
    return this.transactionService.migrateFromLocal(dto.transactions || []);
  }

  @Permissions('transactions.update')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTransactionDto, @Req() req: any) {
    return this.transactionService.updateById(id, dto, req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('transactions.update')
  @Put(':id')
  async replace(@Param('id') id: string, @Body() dto: UpdateTransactionDto, @Req() req: any) {
    return this.transactionService.updateById(id, dto, req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('transactions.delete')
  @Delete(':id')
  async deleteById(@Param('id') id: string, @Req() req: any) {
    return this.transactionService.deleteOne(id, req.user?.sub || req.user?.id, req.user?.username);
  }

  @Permissions('transactions.delete')
  @Post('delete')
  async delete(@Body() dto: DeleteTransactionsDto, @Req() req: any) {
    return this.transactionService.deleteMany(dto, req.user?.sub || req.user?.id, req.user?.username);
  }
}
