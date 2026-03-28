import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class LockUserDto {
  @IsOptional()
  @IsBoolean()
  locked?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 365)
  durationMinutes?: number = 60 * 24;

  @IsOptional()
  @IsString()
  reason?: string;
}

