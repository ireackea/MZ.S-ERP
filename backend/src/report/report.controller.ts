// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Professional PDF Reporting - 2026-02-27
import { Body, Controller, Get, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportDto } from './dto/report.dto';
import { GenerateReportDto } from './dto/generate-report.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Permissions('reports.view')
  @Get()
  async getReport(@Query() query: ReportDto) {
    if (query.endDate && query.startDate && new Date(query.endDate) < new Date(query.startDate)) {
      throw new BadRequestException('تاريخ النهاية يجب أن يكون بعد تاريخ البداية.');
    }
    return this.reportService.getFilteredTransactions(query);
  }

  @Permissions('reports.generate')
  @Post('generate')
  async generate(@Body() dto: GenerateReportDto) {
    if (dto.dateTo && dto.dateFrom && new Date(dto.dateTo) < new Date(dto.dateFrom)) {
      throw new BadRequestException('تاريخ النهاية يجب أن يكون بعد تاريخ البداية.');
    }
    return this.reportService.generate(dto);
  }
}
