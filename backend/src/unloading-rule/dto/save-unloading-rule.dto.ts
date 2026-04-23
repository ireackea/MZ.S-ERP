import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SaveUnloadingRuleDto {
  @IsString()
  rule_name!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  allowed_duration_minutes!: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  penalty_rate_per_minute!: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}