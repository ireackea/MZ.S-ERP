import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateStocktakingSessionDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  monthKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  warehouseId?: string;
}

export class UpsertStocktakingEntryDto {
  @IsString()
  itemId!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999999999.999)
  actualCount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CloseStocktakingDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  archivedPdfName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  archivedPdfMime?: string;

  @IsOptional()
  @IsString()
  archivedPdfData?: string;
}

export class StocktakingQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  warehouseId?: string;
}

export class StocktakingStatusDto {
  @IsIn(['open', 'closed'])
  status!: 'open' | 'closed';

  @IsOptional()
  @IsDateString()
  closedAt?: string;

  @IsBoolean()
  hasConflicts!: boolean;
}
