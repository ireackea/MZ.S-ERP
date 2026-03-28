import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PrintReportColumnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  label!: string;

  @IsOptional()
  @IsString()
  @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';
}

export class PrintReportSummaryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  label!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  value!: string;
}

export class PrintReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  generatedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  filename?: string;

  @IsOptional()
  @IsString()
  @IsIn(['A4', 'Letter'])
  paperSize?: 'A4' | 'Letter';

  @IsOptional()
  @IsBoolean()
  landscape?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrintReportColumnDto)
  columns!: PrintReportColumnDto[];

  @IsArray()
  @IsObject({ each: true })
  rows!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrintReportSummaryDto)
  summary?: PrintReportSummaryDto[];
}

