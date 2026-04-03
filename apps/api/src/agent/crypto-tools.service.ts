import { Inject, Injectable, Optional } from '@nestjs/common';
import { CryptoNewsApiClient } from '../news/fetchers/crypto-news-api.client';
import type { CryptoNewsArticle } from '../news/fetchers/crypto-news-api.client';
import type { OkxApiClient } from '../okx/okx-api.client';
import type { OkxPosition } from '../okx/interfaces/okx-types';

@Injectable()
export class CryptoToolsService {
  constructor(
    private readonly cryptoNewsApiClient: CryptoNewsApiClient,
    @Optional()
    @Inject('OKX_API_CLIENT')
    private readonly okxApiClient?: OkxApiClient | null,
  ) {}

  async getCryptoNews(
    keyword: string,
    coin?: string,
    minScore = 0,
    limit = 10,
  ): Promise<string> {
    const query = coin ? `${keyword} ${coin}`.trim() : keyword;
    const articles = await this.cryptoNewsApiClient.searchNews(query, Math.max(limit * 2, 20));
    const upperCoin = coin?.toUpperCase().trim();

    const filtered = articles
      .filter((article) => (article.ai_score ?? 0) >= minScore)
      .filter((article) => {
        if (!upperCoin) return true;
        return (
          article.tickers?.some((ticker) => ticker.toUpperCase() === upperCoin) ||
          article.title.toUpperCase().includes(upperCoin) ||
          article.summary?.toUpperCase().includes(upperCoin)
        );
      })
      .slice(0, limit);

    if (filtered.length === 0) {
      return `No crypto news matched keyword="${keyword}"${upperCoin ? ` coin=${upperCoin}` : ''}.`;
    }

    return filtered.map((article, index) => this.formatArticle(article, index)).join('\n\n');
  }

  async getCryptoNewsBySignal(signal: string, limit: number): Promise<string> {
    const articles = await this.cryptoNewsApiClient.searchNews('crypto market', 50);
    const filtered = articles
      .filter((article) => article.ai_signal?.toLowerCase() === signal.toLowerCase())
      .slice(0, limit);

    if (filtered.length === 0) {
      return `No crypto news articles matched signal="${signal}".`;
    }

    return filtered.map((article, index) => this.formatArticle(article, index)).join('\n\n');
  }

  async getFundingRate(instId: string): Promise<string> {
    const client = this.requireOkxClient();
    const fundingRate = await client.getFundingRate(instId);

    if (!fundingRate) {
      return `Funding rate unavailable for ${instId}.`;
    }

    return [
      `Instrument: ${fundingRate.instId}`,
      `Current funding: ${fundingRate.fundingRate}`,
      `Next funding: ${fundingRate.nextFundingRate}`,
      `Next settlement: ${new Date(Number(fundingRate.fundingTime)).toISOString()}`,
    ].join('\n');
  }

  async analyzePosition(instId: string): Promise<string> {
    const client = this.requireOkxClient();
    const [ticker, fundingRate, positions] = await Promise.all([
      client.getTicker(instId),
      client.getFundingRate(instId),
      client.getPositions(),
    ]);

    const matchingPositions = positions.filter((position) => position.instId === instId);
    const sections: string[] = [`Instrument: ${instId}`];

    if (ticker) {
      sections.push(
        [
          'Ticker:',
          `  Last: ${ticker.last}`,
          `  Bid/Ask: ${ticker.bidPx} / ${ticker.askPx}`,
          `  24h High/Low: ${ticker.high24h} / ${ticker.low24h}`,
          `  24h Volume: ${ticker.vol24h}`,
        ].join('\n'),
      );
    }

    if (fundingRate) {
      sections.push(
        [
          'Funding:',
          `  Current: ${fundingRate.fundingRate}`,
          `  Next: ${fundingRate.nextFundingRate}`,
          `  Settlement: ${new Date(Number(fundingRate.fundingTime)).toISOString()}`,
        ].join('\n'),
      );
    }

    if (matchingPositions.length === 0) {
      sections.push('Position: no open OKX position found for this instrument.');
    } else {
      sections.push(
        [
          'Positions:',
          ...matchingPositions.map((position, index) => this.formatPosition(position, index + 1)),
        ].join('\n'),
      );
    }

    return sections.join('\n\n');
  }

  async setLeverage(instId: string, leverage: number, marginMode: string): Promise<string> {
    const client = this.requireOkxClient();
    const success = await client.setLeverage(instId, String(leverage), marginMode);

    if (!success) {
      return `Failed to set leverage for ${instId} to ${leverage}x (${marginMode}).`;
    }

    return `Leverage updated: ${instId} -> ${leverage}x (${marginMode}).`;
  }

  private requireOkxClient(): OkxApiClient {
    if (!this.okxApiClient) {
      throw new Error(
        'OKX integration is disabled or credentials are missing. Enable APP_OKX_ENABLED and configure OKX credentials first.',
      );
    }

    return this.okxApiClient;
  }

  private formatArticle(article: CryptoNewsArticle, index: number): string {
    return [
      `${index + 1}. ${article.title}`,
      `Published: ${article.published_at}`,
      `Score: ${article.ai_score ?? 'N/A'} | Signal: ${article.ai_signal ?? 'N/A'}`,
      `Tickers: ${(article.tickers ?? []).join(', ') || 'N/A'}`,
      ...(article.summary ? [`Summary: ${article.summary}`] : []),
      ...(article.url ? [`URL: ${article.url}`] : []),
    ].join('\n');
  }

  private formatPosition(position: OkxPosition, index: number): string {
    const liquidationDistance =
      position.liqPx && position.markPx
        ? this.calculateDistancePct(position.markPx, position.liqPx)
        : null;

    return [
      `  ${index}. ${position.posSide || 'net'} ${position.pos}`,
      `     AvgPx: ${position.avgPx} | MarkPx: ${position.markPx}`,
      `     UPL: ${position.upl} | Leverage: ${position.lever}x`,
      `     Margin mode: ${position.mgnMode} | LiqPx: ${position.liqPx || 'N/A'}`,
      `     Liquidation distance: ${liquidationDistance ?? 'N/A'}`,
    ].join('\n');
  }

  private calculateDistancePct(markPx: string, liqPx: string): string | null {
    const mark = Number(markPx);
    const liq = Number(liqPx);
    if (!Number.isFinite(mark) || !Number.isFinite(liq) || mark === 0) {
      return null;
    }
    return `${(Math.abs(mark - liq) / mark * 100).toFixed(2)}%`;
  }
}
