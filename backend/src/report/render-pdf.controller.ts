import { Body, Controller, Post, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RbacGuard } from '../auth/rbac.guard';
import { RenderHtmlPdfDto } from './dto/print-report.dto';
import { ReportService } from './report.service';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller()
export class RenderPdfController {
  constructor(private readonly reportService: ReportService) {}

  @Permissions('reports.generate')
  @Post('render-pdf')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async renderPdf(@Body() dto: RenderHtmlPdfDto, @Res() res: Response) {
    const buffer = await this.reportService.renderHtmlPdf(dto);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="rendered-document.pdf"');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}