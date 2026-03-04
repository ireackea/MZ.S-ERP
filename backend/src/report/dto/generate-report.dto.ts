import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class GenerateReportDto {
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  warehouseIds?: string[];

  @IsIn(['inventory', 'movements'])
  type!: 'inventory' | 'movements';
}

