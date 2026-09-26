import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * FC-API-002 — the report list query contract.
 *
 * These fields previously carried no decorators, so the global
 * `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` rejected
 * `page`, `limit`, `startDate` and `endDate` outright — `GET /reports` returned
 * 400 for every filtered or paginated request.
 */
export class ReportDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  /** publicId values from the frontend, never internal numeric ids. */
  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  itemIds?: string[];

  @IsOptional()
  @IsString()
  partner?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
