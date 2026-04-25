import type { CompanyProfile, FinancialMetrics, AnalystConsensus } from '@finsentinel/shared';

/**
 * Contract for research-data providers (Polygon, Yahoo, etc.).
 *
 * Each provider is auto-discovered by the registry and indexed by name.
 */
export interface ResearchDataProvider {
  /** Unique provider identifier, e.g. "polygon". */
  getName(): string;

  /** Fetch company profile for a ticker. */
  getCompanyProfile(ticker: string): Promise<CompanyProfile>;

  /** Fetch financial metrics for a ticker over a number of periods. */
  getFinancialMetrics(ticker: string, periods?: number): Promise<FinancialMetrics[]>;

  /** Fetch analyst consensus for a ticker. */
  getAnalystConsensus(ticker: string): Promise<AnalystConsensus>;
}
