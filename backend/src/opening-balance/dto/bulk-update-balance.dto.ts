import { IsArray, ValidateNested, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkBalanceEntryDto {
  @IsString()
  itemPublicId!: string;

  @IsNumber()
  financialYear!: number;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  unitCost?: number;
}

export class BulkUpdateBalanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkBalanceEntryDto)
  bulk!: BulkBalanceEntryDto[];
}
