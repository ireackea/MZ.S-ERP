// ENTERPRISE FIX: Professional PDF Reporting - 2026-02-27
import { BadRequestException, Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../prisma.service';
import { GenerateReportDto } from './dto/generate-report.dto';
import { ReportDto } from './dto/report.dto';
import { PrintReportDto } from './dto/print-report.dto';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  private isInboundType(type: string): boolean {
    const lowerType = String(type || '').toLowerCase();
    return (
      lowerType.includes('in') ||
      lowerType.includes('inbound') ||
      lowerType.includes('incoming') ||
      lowerType.includes('purchase') ||
      lowerType.includes('import') ||
      lowerType.includes('production') ||
      lowerType.includes('وارد') ||
      lowerType.includes('ادخال') ||
      lowerType.includes('إدخال') ||
      lowerType.includes('انتاج') ||
      lowerType.includes('إنتاج')
    );
  }

  private isOutboundType(type: string): boolean {
    const lowerType = String(type || '').toLowerCase();
    return (
      lowerType.includes('out') ||
      lowerType.includes('outbound') ||
      lowerType.includes('outgoing') ||
      lowerType.includes('sale') ||
      lowerType.includes('export') ||
      lowerType.includes('صادر') ||
      lowerType.includes('خروج')
    );
  }

  private async resolveItemIds(publicIds?: string[]) {
    if (!publicIds || publicIds.length === 0) return null;

    const items = await this.prisma.item.findMany({
      where: { publicId: { in: publicIds } },
      select: { id: true },
    });

    if (!items.length) return [] as number[];
    return items.map((item) => item.id);
  }

  async getFilteredTransactions(dto: ReportDto) {
    if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date cannot be earlier than start date');
    }

    const where: any = {};

    if (dto.startDate || dto.endDate) {
      where.date = {};
      if (dto.startDate) where.date.gte = new Date(dto.startDate);
      if (dto.endDate) where.date.lte = new Date(dto.endDate);
    }

    const resolvedItemIds = await this.resolveItemIds(dto.itemIds);
    if (Array.isArray(resolvedItemIds)) {
      if (resolvedItemIds.length === 0) return { data: [], total: 0 };
      where.itemId = { in: resolvedItemIds };
    }

    if (dto.partner) {
      where.supplierOrReceiver = { contains: dto.partner, mode: 'insensitive' };
    }

    const take = Math.min(Number(dto.limit) || 50, 500);
    const skip = Math.max(0, ((Number(dto.page) || 1) - 1) * take);

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take,
        include: {
          item: {
            select: {
              id: true,
              publicId: true,
              name: true,
              code: true,
              unit: true,
            },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const data = rows.map((t) => ({
      id: t.id,
      date: t.date instanceof Date ? t.date.toISOString().split('T')[0] : t.date,
      warehouseInvoice: t.warehouseInvoice,
      itemId: t.item?.publicId || String(t.itemId),
      type: t.type,
      quantity: Number(t.quantity),
      supplierOrReceiver: t.supplierOrReceiver,
      truckNumber: t.truckNumber,
      driverName: t.driverName,
      notes: t.notes,
      warehouseId: t.warehouseId,
      item: t.item,
    }));

    return { data, total };
  }

  async generate(dto: GenerateReportDto) {
    const dateFrom = dto.dateFrom ? new Date(dto.dateFrom) : undefined;
    const dateTo = dto.dateTo ? new Date(dto.dateTo) : undefined;

    if (dateFrom && Number.isNaN(dateFrom.getTime())) {
      throw new BadRequestException('Invalid dateFrom format');
    }
    if (dateTo && Number.isNaN(dateTo.getTime())) {
      throw new BadRequestException('Invalid dateTo format');
    }

    const where: any = {};
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom;
      if (dateTo) where.date.lte = dateTo;
    }

    const resolvedItemIds = await this.resolveItemIds(dto.itemIds);
    if (Array.isArray(resolvedItemIds)) {
      if (resolvedItemIds.length === 0) {
        return {
          data: [],
          summary: {
            totalTransactions: 0,
            totalIn: 0,
            totalOut: 0,
            net: 0,
            itemCount: 0,
          },
          chartData: [],
        };
      }
      where.itemId = { in: resolvedItemIds };
    }

    if (dto.warehouseIds && dto.warehouseIds.length > 0) {
      where.warehouseId = { in: dto.warehouseIds };
    }

    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      include: {
        item: {
          select: {
            id: true,
            publicId: true,
            name: true,
            code: true,
            unit: true,
          },
        },
      },
    });

    const normalized = rows.map((row) => ({
      id: row.publicId || String(row.id),
      date: row.date.toISOString().split('T')[0],
      itemId: row.item?.publicId || String(row.itemId),
      itemName: row.item?.name || '',
      itemCode: row.item?.code || '',
      warehouseId: row.warehouseId || '',
      type: row.type,
      quantity: Number(row.quantity || 0),
      supplierOrReceiver: row.supplierOrReceiver,
      warehouseInvoice: row.warehouseInvoice || '',
      notes: row.notes || '',
    }));

    if (dto.type === 'inventory') {
      const grouped = new Map<string, { itemId: string; itemName: string; itemCode: string; currentStock: number }>();

      normalized.forEach((row) => {
        const key = row.itemId;
        const existing = grouped.get(key) || {
          itemId: row.itemId,
          itemName: row.itemName,
          itemCode: row.itemCode,
          currentStock: 0,
        };

        const isInbound = this.isInboundType(row.type);

        existing.currentStock += isInbound ? row.quantity : -row.quantity;
        grouped.set(key, existing);
      });

      const inventoryData = Array.from(grouped.values()).map((entry) => ({
        ...entry,
        currentStock: Number(entry.currentStock.toFixed(3)),
      }));

      return {
        data: inventoryData,
        summary: {
          totalTransactions: normalized.length,
          itemCount: inventoryData.length,
          totalIn: Number(
            normalized
              .filter((r) => this.isInboundType(r.type))
              .reduce((sum, r) => sum + r.quantity, 0)
              .toFixed(3),
          ),
          totalOut: Number(
            normalized
              .filter((r) => this.isOutboundType(r.type))
              .reduce((sum, r) => sum + r.quantity, 0)
              .toFixed(3),
          ),
          net: Number(inventoryData.reduce((sum, row) => sum + row.currentStock, 0).toFixed(3)),
        },
        chartData: inventoryData
          .slice(0, 20)
          .map((row) => ({ label: row.itemCode || row.itemName, value: row.currentStock })),
      };
    }

    const totalIn = normalized
      .filter((r) => this.isInboundType(r.type))
      .reduce((sum, r) => sum + r.quantity, 0);

    const totalOut = normalized
      .filter((r) => this.isOutboundType(r.type))
      .reduce((sum, r) => sum + r.quantity, 0);

    const chartMap = new Map<string, { date: string; in: number; out: number }>();
    normalized.forEach((row) => {
      const key = row.date;
      const entry = chartMap.get(key) || { date: key, in: 0, out: 0 };
      if (this.isInboundType(row.type)) {
        entry.in += row.quantity;
      } else if (this.isOutboundType(row.type)) {
        entry.out += row.quantity;
      }
      chartMap.set(key, entry);
    });

    return {
      data: normalized,
      summary: {
        totalTransactions: normalized.length,
        totalIn: Number(totalIn.toFixed(3)),
        totalOut: Number(totalOut.toFixed(3)),
        net: Number((totalIn - totalOut).toFixed(3)),
        itemCount: new Set(normalized.map((r) => r.itemId)).size,
      },
      chartData: Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  buildPdfFilename(input: string): string {
    const normalized = String(input || 'feedfactory-report')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return normalized || 'feedfactory-report';
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatCellValue(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private buildPrintHtml(dto: PrintReportDto): string {
    const renderedAt = new Date().toLocaleString('en-GB', { hour12: false });
    const summaryHtml = Array.isArray(dto.summary) && dto.summary.length > 0
      ? `
        <section class="summary-grid">
          ${dto.summary
            .map(
              (entry) => `
                <div class="summary-card">
                  <p class="summary-label">${this.escapeHtml(entry.label)}</p>
                  <p class="summary-value">${this.escapeHtml(entry.value)}</p>
                </div>
              `,
            )
            .join('')}
        </section>
      `
      : '';

    const headerRow = dto.columns
      .map((column) => {
        const align = column.align || 'left';
        return `<th class="align-${align}">${this.escapeHtml(column.label)}</th>`;
      })
      .join('');

    const bodyRows = dto.rows.length
      ? dto.rows
          .map((row) => {
            const cells = dto.columns
              .map((column) => {
                const align = column.align || 'left';
                const raw = (row as Record<string, unknown>)[column.key];
                return `<td class="align-${align}">${this.escapeHtml(this.formatCellValue(raw))}</td>`;
              })
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('')
      : `<tr><td colspan="${dto.columns.length}" class="empty-state">No rows available</td></tr>`;

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(dto.title)}</title>
    <style>
      :root {
        --ink: #0f172a;
        --muted: #64748b;
        --line: #cbd5e1;
        --soft: #f8fafc;
        --brand: #0f766e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Segoe UI", Tahoma, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.45;
        background: #fff;
      }
      .sheet { padding: 24px 8px 0; }
      .report-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 14px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .logo {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: linear-gradient(135deg, #0f766e, #0891b2);
        color: #fff;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.4px;
      }
      .brand-meta h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
      }
      .brand-meta p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 11px;
      }
      .meta {
        text-align: right;
        color: var(--muted);
        font-size: 11px;
      }
      .meta strong { color: var(--ink); }
      .report-title {
        margin: 14px 0 6px;
        font-size: 16px;
        font-weight: 700;
      }
      .report-subtitle {
        margin: 0 0 12px;
        color: var(--muted);
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin: 0 0 12px;
      }
      .summary-card {
        border: 1px solid var(--line);
        background: var(--soft);
        border-radius: 8px;
        padding: 8px 10px;
      }
      .summary-label {
        margin: 0;
        color: var(--muted);
        font-size: 10px;
      }
      .summary-value {
        margin: 4px 0 0;
        font-size: 13px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border-spacing: 0;
      }
      thead th {
        background: #e2e8f0;
        color: #0f172a;
        font-size: 11px;
        font-weight: 700;
        border: 1px solid var(--line);
        padding: 8px 7px;
      }
      tbody td {
        border: 1px solid var(--line);
        padding: 7px 7px;
        vertical-align: top;
      }
      tbody tr:nth-child(even) td {
        background: #f8fafc;
      }
      .align-left { text-align: left; }
      .align-center { text-align: center; }
      .align-right { text-align: right; }
      .empty-state {
        text-align: center;
        color: var(--muted);
        padding: 18px 10px;
      }
      .footer-note {
        margin-top: 10px;
        color: var(--muted);
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <header class="report-header">
        <div class="brand">
          <div class="logo">FF</div>
          <div class="brand-meta">
            <h1>FeedFactory Pro</h1>
            <p>Professional Reporting Suite</p>
          </div>
        </div>
        <div class="meta">
          <div><strong>Generated:</strong> ${this.escapeHtml(renderedAt)}</div>
          <div><strong>By:</strong> ${this.escapeHtml(dto.generatedBy || 'System')}</div>
        </div>
      </header>

      <h2 class="report-title">${this.escapeHtml(dto.title)}</h2>
      ${dto.subtitle ? `<p class="report-subtitle">${this.escapeHtml(dto.subtitle)}</p>` : ''}

      ${summaryHtml}

      <table>
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <p class="footer-note">Confidential report generated for operational use only.</p>
    </main>
  </body>
</html>`;
  }

  async buildPrintablePdf(dto: PrintReportDto): Promise<Buffer> {
    if (!dto.columns?.length) {
      throw new BadRequestException('columns must contain at least one column.');
    }
    if (dto.columns.length > 20) {
      throw new BadRequestException('columns count exceeds allowed limit (20).');
    }
    if (!Array.isArray(dto.rows)) {
      throw new BadRequestException('rows must be an array.');
    }
    if (dto.rows.length > 5000) {
      throw new BadRequestException('rows count exceeds allowed limit (5000).');
    }

    const html = this.buildPrintHtml(dto);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: dto.paperSize || 'A4',
        landscape: Boolean(dto.landscape),
        printBackground: true,
        displayHeaderFooter: true,
        margin: {
          top: '64px',
          bottom: '64px',
          left: '24px',
          right: '24px',
        },
        headerTemplate: `
          <div style="width:100%; font-size:9px; color:#64748b; padding:0 18px; text-align:center;">
            FeedFactory Pro - ${this.escapeHtml(dto.title)}
          </div>
        `,
        footerTemplate: `
          <div style="width:100%; font-size:9px; color:#64748b; padding:0 18px; display:flex; justify-content:space-between;">
            <span>(c) FeedFactory Pro</span>
            <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>
        `,
      });

      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

