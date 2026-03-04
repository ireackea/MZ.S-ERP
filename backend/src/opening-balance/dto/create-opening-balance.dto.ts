import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOpeningBalanceDto {
  @IsString()
  itemPublicId!: string;

  @IsInt()
  financialYear!: number;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  unitCost?: number;
}
