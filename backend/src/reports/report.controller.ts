// ENTERPRISE FIX: Legacy Migration Phase 3 - Professional PDF Reporting - 2026-02-27
import {
  Body,
  Controller,
  Post,
  Res,
  UseGuards,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ReportService, PrintableReportType } from './report.service';

class PrintReportRequestDto {
  @IsIn(['dashboard', 'items', 'transactions'])
  type!: PrintableReportType;

  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  generatedBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  filename?: string;
}

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Permissions('reports.generate')
  @Post('print')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async print(@Body() dto: PrintReportRequestDto, @Res() res: Response) {
    const { buffer, filename } = await this.reportService.generateReportPdf(dto);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}

export type { PrintReportRequestDto };
