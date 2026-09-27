import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  role?: string;

  // FC-SEC-012 — `inactive` was handled in the service but rejected here, so the
  // branch was unreachable dead code and a deactivated account could not be
  // filtered for at all.
  @IsOptional()
  @IsIn(['active', 'locked', 'inactive'])
  status?: 'active' | 'locked' | 'inactive';
}

