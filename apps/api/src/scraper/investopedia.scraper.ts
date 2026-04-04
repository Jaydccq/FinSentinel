import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { documents, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { FirecrawlClient } from './firecrawl.client';
import { VectorizeProducer } from '../queue/vectorize.producer';

/**
 * Investopedia financial terms scraper.
 *
 * Maintains a hardcoded list of key financial terms URLs.
 * Uses Firecrawl to get markdown content, then saves to Document table.
 */
@Injectable()
export class InvestopediaScraper {
  private readonly logger = new Logger(InvestopediaScraper.name);

  /** Curated list of essential financial terms for RAG knowledge base. */
  private static readonly TERM_URLS: ReadonlyArray<{
    slug: string;
    url: string;
  }> = [
    { slug: 'price-to-earnings-ratio', url: 'https://www.investopedia.com/terms/p/price-earningsratio.asp' },
    { slug: 'earnings-per-share', url: 'https://www.investopedia.com/terms/e/eps.asp' },
    { slug: 'return-on-equity', url: 'https://www.investopedia.com/terms/r/returnonequity.asp' },
    { slug: 'debt-to-equity-ratio', url: 'https://www.investopedia.com/terms/d/debtequityratio.asp' },
    { slug: 'market-capitalization', url: 'https://www.investopedia.com/terms/m/marketcapitalization.asp' },
    { slug: 'dividend-yield', url: 'https://www.investopedia.com/terms/d/dividendyield.asp' },
    { slug: 'beta', url: 'https://www.investopedia.com/terms/b/beta.asp' },
    { slug: 'alpha', url: 'https://www.investopedia.com/terms/a/alpha.asp' },
    { slug: 'sharpe-ratio', url: 'https://www.investopedia.com/terms/s/sharperatio.asp' },
    { slug: 'bollinger-bands', url: 'https://www.investopedia.com/terms/b/bollingerbands.asp' },
    { slug: 'relative-strength-index', url: 'https://www.investopedia.com/terms/r/rsi.asp' },
    { slug: 'moving-average-convergence-divergence', url: 'https://www.investopedia.com/terms/m/macd.asp' },
    { slug: 'simple-moving-average', url: 'https://www.investopedia.com/terms/s/sma.asp' },
    { slug: 'exponential-moving-average', url: 'https://www.investopedia.com/terms/e/ema.asp' },
    { slug: 'volume-weighted-average-price', url: 'https://www.investopedia.com/terms/v/vwap.asp' },
    { slug: 'free-cash-flow', url: 'https://www.investopedia.com/terms/f/freecashflow.asp' },
    { slug: 'operating-margin', url: 'https://www.investopedia.com/terms/o/operatingmargin.asp' },
    { slug: 'net-profit-margin', url: 'https://www.investopedia.com/terms/n/net_margin.asp' },
    { slug: 'current-ratio', url: 'https://www.investopedia.com/terms/c/currentratio.asp' },
    { slug: 'quick-ratio', url: 'https://www.investopedia.com/terms/q/quickratio.asp' },
    { slug: 'enterprise-value', url: 'https://www.investopedia.com/terms/e/enterprisevalue.asp' },
    { slug: 'price-to-book-ratio', url: 'https://www.investopedia.com/terms/p/price-to-bookratio.asp' },
    { slug: 'price-to-sales-ratio', url: 'https://www.investopedia.com/terms/p/price-to-salesratio.asp' },
    { slug: 'short-interest', url: 'https://www.investopedia.com/terms/s/shortinterest.asp' },
    { slug: 'put-call-ratio', url: 'https://www.investopedia.com/terms/p/putcallratio.asp' },
    { slug: 'implied-volatility', url: 'https://www.investopedia.com/terms/i/iv.asp' },
    { slug: 'volatility', url: 'https://www.investopedia.com/terms/v/volatility.asp' },
    { slug: 'standard-deviation', url: 'https://www.investopedia.com/terms/s/standarddeviation.asp' },
    { slug: 'value-at-risk', url: 'https://www.investopedia.com/terms/v/var.asp' },
    { slug: 'monte-carlo-simulation', url: 'https://www.investopedia.com/terms/m/montecarlosimulation.asp' },
    { slug: 'efficient-frontier', url: 'https://www.investopedia.com/terms/e/efficientfrontier.asp' },
    { slug: 'capital-asset-pricing-model', url: 'https://www.investopedia.com/terms/c/capm.asp' },
    { slug: 'discounted-cash-flow', url: 'https://www.investopedia.com/terms/d/dcf.asp' },
    { slug: 'net-present-value', url: 'https://www.investopedia.com/terms/n/npv.asp' },
    { slug: 'internal-rate-of-return', url: 'https://www.investopedia.com/terms/i/irr.asp' },
    { slug: 'weighted-average-cost-of-capital', url: 'https://www.investopedia.com/terms/w/wacc.asp' },
    { slug: 'earnings-before-interest-taxes', url: 'https://www.investopedia.com/terms/e/ebit.asp' },
    { slug: 'ebitda', url: 'https://www.investopedia.com/terms/e/ebitda.asp' },
    { slug: 'gross-domestic-product', url: 'https://www.investopedia.com/terms/g/gdp.asp' },
    { slug: 'inflation', url: 'https://www.investopedia.com/terms/i/inflation.asp' },
    { slug: 'federal-funds-rate', url: 'https://www.investopedia.com/terms/f/federalfundsrate.asp' },
    { slug: 'yield-curve', url: 'https://www.investopedia.com/terms/y/yieldcurve.asp' },
    { slug: 'treasury-bonds', url: 'https://www.investopedia.com/terms/t/treasurybond.asp' },
    { slug: 'hedge-fund', url: 'https://www.investopedia.com/terms/h/hedgefund.asp' },
    { slug: 'exchange-traded-fund', url: 'https://www.investopedia.com/terms/e/etf.asp' },
    { slug: 'mutual-fund', url: 'https://www.investopedia.com/terms/m/mutualfund.asp' },
    { slug: 'options', url: 'https://www.investopedia.com/terms/o/option.asp' },
    { slug: 'futures-contract', url: 'https://www.investopedia.com/terms/f/futurescontract.asp' },
    { slug: 'margin-trading', url: 'https://www.investopedia.com/terms/m/margin.asp' },
    { slug: 'dollar-cost-averaging', url: 'https://www.investopedia.com/terms/d/dollarcostaveraging.asp' },
  ];

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly firecrawl: FirecrawlClient,
    @Optional() private readonly vectorizeProducer?: VectorizeProducer,
  ) {}

  /**
   * Scrape Investopedia financial terms.
   * @param maxTerms - optional limit on number of terms to process
   * Returns the count of newly saved documents.
   */
  async scrape(maxTerms?: number): Promise<number> {
    const terms = maxTerms
      ? InvestopediaScraper.TERM_URLS.slice(0, maxTerms)
      : InvestopediaScraper.TERM_URLS;

    let savedCount = 0;

    for (const term of terms) {
      try {
        const saved = await this.scrapeTerm(term.slug, term.url);
        if (saved) savedCount++;
      } catch (err) {
        this.logger.warn(
          `Failed to scrape term ${term.slug}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Investopedia scrape complete: ${savedCount} new terms saved`,
    );
    return savedCount;
  }

  private async scrapeTerm(
    slug: string,
    url: string,
  ): Promise<boolean> {
    const originalFileName = `investopedia-${slug}`;

    // Dedup: skip if document already exists
    const existing = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.originalFileName, originalFileName))
      .limit(1);

    if (existing.length > 0) {
      return false;
    }

    const markdown = await this.firecrawl.scrape(url);
    if (!markdown) {
      this.logger.warn(`No content scraped for term ${slug}`);
      return false;
    }

    const [inserted] = await this.db
      .insert(documents)
      .values({
        fileName: `${slug}.md`,
        originalFileName,
        docType: 'FINANCIAL_TERM',
        status: 'PENDING',
        sector: null,
        regionId: 'US',
        fileSize: Buffer.byteLength(markdown, 'utf-8'),
      })
      .returning({ id: documents.id });

    if (inserted?.id && this.vectorizeProducer) {
      await this.vectorizeProducer.send(inserted.id);
      this.logger.log(`Enqueued vectorization for doc ${inserted.id}`);
    }
    return true;
  }
}
