import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class ComputedBalancesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(2000)
  financialYear?: number;
}

