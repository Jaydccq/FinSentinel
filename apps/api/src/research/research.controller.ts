import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CompanyResearchService } from './company-research.service';
import { parseIntParam } from '../common/utils/parse-int-param';

/**
 * Research controller — company profile and financial metrics.
 */
@Controller('research')
@UseGuards(JwtGuard)
export class ResearchController {
  constructor(private readonly researchService: CompanyResearchService) {}

  /** GET /research/profile/:ticker — company profile. */
  @Get('profile/:ticker')
  async getProfile(
    @Param('ticker') ticker: string,
    @Query('provider') provider?: string,
  ) {
    return this.researchService.getCompanyProfile(ticker, provider);
  }

  /** GET /research/financials/:ticker — financial metrics. */
  @Get('financials/:ticker')
  async getFinancials(
    @Param('ticker') ticker: string,
    @Query('periods') periodsParam?: string,
    @Query('provider') provider?: string,
  ) {
    const periods = parseIntParam(periodsParam, 4, 1, 20);
    return this.researchService.getFinancialMetrics(ticker, periods, provider);
  }
}
