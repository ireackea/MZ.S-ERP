import { IsArray, IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateTransactionDto } from './create-transaction.dto';

export class MigrateFromLocalDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionDto)
  transactions!: CreateTransactionDto[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  clearLocal?: boolean;
}

