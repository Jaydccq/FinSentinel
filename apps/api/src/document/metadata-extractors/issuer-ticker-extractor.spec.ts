import { extractIssuerAndTickers } from './issuer-ticker-extractor';

describe('extractIssuerAndTickers', () => {
  it('pulls ticker from 10-K filename like "AAPL_10K_2024.pdf"', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'AAPL_10K_2024.pdf',
      docTitle: null,
      chunkText: 'Apple Inc. reported revenue of $383B.',
    });
    expect(result.tickers).toContain('AAPL');
    expect(result.issuerName).toBe('Apple Inc.');
  });

  it('returns empty when no ticker-like token exists', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'general-news.txt',
      docTitle: null,
      chunkText: 'Markets opened lower today on inflation data.',
    });
    expect(result.tickers).toEqual([]);
    expect(result.issuerName).toBeUndefined();
  });

  it('de-dupes tickers found in multiple sources', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'TSLA_earnings.pdf',
      docTitle: 'Tesla Inc. Q3 2024 Earnings',
      chunkText: 'TSLA reported record deliveries this quarter.',
    });
    expect(result.tickers).toEqual(['TSLA']);
  });

  it('ignores 2-letter words that are not in the whitelist', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'research-note.md',
      docTitle: null,
      chunkText: 'We see CEO commentary as material.',
    });
    expect(result.tickers).toEqual([]); // CEO, SEE are not whitelisted tickers
  });
});
