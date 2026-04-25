import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ReportService } from './report.service';

/**
 * Report controller — PDF download of risk reports.
 */
@Controller('reports')
@UseGuards(JwtGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /** GET /reports/:id/pdf — download a risk report as PDF (currently markdown). */
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.reportService.getReportPdf(user.userId, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="risk-report-${id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }
}
