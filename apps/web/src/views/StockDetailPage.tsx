'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Time } from 'lightweight-charts';
import CandlestickChart from '../components/CandlestickChart';
import { marketApi, type QuoteData } from '../api/market';
import { newsApi, type NewsSummary, type NewsItemResponse } from '../api/news';
import { researchApi, type CompanyProfile, type FinancialMetrics } from '../api/research';
import StockAnalysisSection from '../components/StockAnalysisSection';
import { FreshnessBadge } from '../components/freshness/FreshnessBadge';
import { normalizeQuoteTimestampMs } from '../lib/freshness/quote-timestamp';

interface HistoryBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const SOURCE_LABELS: Record<string, string> = {
  POLYGON: 'Polygon',
  RSS_CNBC: 'CNBC',
  RSS_YAHOO: 'Yahoo Finance',
  RSS_BBC: 'BBC',
  RSS_GUARDIAN: 'Guardian',
  RSS_NPR: 'NPR',
  RSS_REUTERS_PROXY: 'Reuters',
  X_INFLUENCER: 'X / Twitter',
  RSS_SIGNALHUB: 'SignalHub',
  CRYPTO_6551: 'Crypto 6551',
};

const SOURCE_COLORS: Record<string, string> = {
  POLYGON: 'bg-blue-500/20 text-blue-100 border-blue-300/30',
  RSS_CNBC: 'bg-yellow-500/20 text-yellow-100 border-yellow-300/30',
  RSS_YAHOO: 'bg-violet-500/20 text-violet-100 border-violet-300/30',
  RSS_BBC: 'bg-rose-500/20 text-rose-100 border-rose-300/30',
  RSS_GUARDIAN: 'bg-sky-500/20 text-sky-100 border-sky-300/30',
  RSS_NPR: 'bg-teal-500/20 text-teal-100 border-teal-300/30',
  RSS_REUTERS_PROXY: 'bg-orange-500/20 text-orange-100 border-orange-300/30',
  X_INFLUENCER: 'bg-slate-500/20 text-slate-100 border-slate-300/30',
  RSS_SIGNALHUB: 'bg-indigo-500/20 text-indigo-100 border-indigo-300/30',
  CRYPTO_6551: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/30',
};

const TIME_RANGES = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

function formatLargeNumber(n: number | null | undefined): string {
  if (n == null) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPercent(n: number | null | undefined): string {
  if (n == null) return '--';
  return `${n.toFixed(2)}%`;
}

function formatRatio(n: number | null | undefined): string {
  if (n == null) return '--';
  return n.toFixed(2);
}

export default function StockDetailPage() {
  const searchParams = useSearchParams();
  const ticker = searchParams.get('ticker') ?? undefined;
  const isCrypto = ticker?.includes('-');
  const requestVersionRef = useRef(0);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [history, setHistory] = useState<HistoryBar[]>([]);
  const [news, setNews] = useState<NewsItemResponse[]>([]);
  const [newsPage, setNewsPage] = useState(0);
  const [hasMoreNews, setHasMoreNews] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<NewsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [activeRange, setActiveRange] = useState('1M');
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [financials, setFinancials] = useState<FinancialMetrics[]>([]);
  const [descExpanded, setDescExpanded] = useState(false);

  const loadTickerData = useCallback((t: string, crypto: boolean) => {
    const requestVersion = ++requestVersionRef.current;
    let cancelled = false;

    setLoading(true);
    setLoadingMore(false);
    setQuote(null);
    setHistory([]);
    setNews([]);
    setNewsPage(0);
    setHasMoreNews(true);
    setSummary(null);
    setSummaryLoading(true);
    setActiveRange('1M');
    setProfile(null);
    setFinancials([]);

    const fetchList: [
      Promise<QuoteData | null>,
      Promise<HistoryBar[]>,
      Promise<{
        content: NewsItemResponse[];
        totalPages: number;
        totalElements: number;
        number: number;
      }>,
      Promise<NewsSummary | null>,
      Promise<CompanyProfile | null>,
      Promise<FinancialMetrics[]>,
    ] = [
      marketApi.quote(t).catch(() => null),
      marketApi.history(t, 30).catch(() => []),
      newsApi
        .byTicker(crypto ? t.split('-')[0] : t, 0, 10)
        .catch(() => ({ content: [], totalPages: 0, totalElements: 0, number: 0 })),
      newsApi.summary(t).catch(() => null),
      crypto ? Promise.resolve(null) : researchApi.profile(t).catch(() => null),
      crypto ? Promise.resolve([]) : researchApi.financials(t, 4).catch(() => []),
    ];

    Promise.all(fetchList)
      .then(([q, h, n, s, p, f]) => {
        if (cancelled || requestVersion !== requestVersionRef.current) return;
        setQuote(q);
        setHistory(h);
        setNews(n.content);
        setHasMoreNews(n.totalPages > 1);
        setSummary(s);
        setProfile(p);
        setFinancials(f);
      })
      .finally(() => {
        if (cancelled || requestVersion !== requestVersionRef.current) return;
        setLoading(false);
        setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ticker) return;
    return loadTickerData(ticker, !!isCrypto); // eslint-disable-line react-hooks/set-state-in-effect -- resets state on ticker change
  }, [ticker, isCrypto, loadTickerData]);

  const handleRangeChange = (label: string, days: number) => {
    if (!ticker || label === activeRange) return;
    setActiveRange(label);
    marketApi
      .history(ticker, days)
      .then((h) => setHistory(h))
      .catch(() => {});
  };

  const loadMoreNews = () => {
    if (!ticker || loadingMore) return;
    const requestVersion = requestVersionRef.current;
    setLoadingMore(true);
    const next = newsPage + 1;
    newsApi
      .byTicker(isCrypto ? ticker!.split('-')[0] : ticker!, next, 10)
      .then((n) => {
        if (requestVersion !== requestVersionRef.current) return;
        setNews((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const deduped = n.content.filter((item) => !existingIds.has(item.id));
          return [...prev, ...deduped];
        });
        setNewsPage(next);
        setHasMoreNews(next + 1 < n.totalPages);
      })
      .finally(() => {
        if (requestVersion !== requestVersionRef.current) return;
        setLoadingMore(false);
      });
  };

  const change = quote && quote.open !== 0 ? ((quote.close - quote.open) / quote.open) * 100 : null;
  const isUp = change !== null && change >= 0;

  // Candlestick data
  const candleData = history.map((bar) => ({
    time: (bar.t / 1000) as Time,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
  }));

  const volumeData = history.map((bar) => ({
    time: (bar.t / 1000) as Time,
    value: bar.v,
    color: bar.c >= bar.o ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
  }));

  return (
    <div className="p-10 space-y-8 max-w-5xl mx-auto">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Dashboard
      </Link>

      {/* Header + Quote */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        {loading ? (
          <p className="text-[var(--text-muted)]">Loading quote data...</p>
        ) : !quote ? (
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl text-[var(--text-primary)]">{ticker}</h1>
              {isCrypto && (
                <span className="text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium border border-orange-400/20">
                  CRYPTO
                </span>
              )}
            </div>
            <p className="text-[var(--warn)] mt-2">Market data unavailable</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl text-[var(--text-primary)]">{ticker}</h1>
                {isCrypto && (
                  <span className="text-xs px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium border border-orange-400/20">
                    CRYPTO
                  </span>
                )}
              </div>
              <span className="text-3xl font-bold text-[var(--text-primary)] font-data tabular-nums">
                ${quote.close.toFixed(2)}
              </span>
              <FreshnessBadge
                surface="quote"
                sourceTimestampMs={normalizeQuoteTimestampMs(quote.timestamp)}
              />
              {change !== null && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-sm font-medium ${
                    isUp
                      ? 'bg-[color:var(--up)]/15 text-[color:var(--up)]'
                      : 'bg-[color:var(--down)]/15 text-[color:var(--down)]'
                  }`}
                >
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? '+' : ''}
                  {change.toFixed(2)}%
                </span>
              )}
            </div>

            {/* OHLC + Volume grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
              {[
                { label: 'Open', value: `$${quote.open.toFixed(2)}` },
                { label: 'High', value: `$${quote.high.toFixed(2)}` },
                { label: 'Low', value: `$${quote.low.toFixed(2)}` },
                { label: 'Close', value: `$${quote.close.toFixed(2)}` },
                { label: 'Volume', value: quote.volume.toLocaleString('en-US') },
              ].map((item) => (
                <div key={item.label} className="bg-[var(--bg-elevated)] rounded p-3">
                  <p className="text-[var(--text-muted)] text-xs">{item.label}</p>
                  <p className="text-[var(--text-primary)] font-semibold font-data tabular-nums mt-0.5">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Broker links */}
            <div className="flex items-center gap-3 mt-6">
              <span className="text-[var(--text-muted)] text-xs">Trade on</span>
              {isCrypto ? (
                <>
                  <a
                    href="https://www.binance.com/trade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    Binance
                  </a>
                  <a
                    href="https://www.coinbase.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    Coinbase
                  </a>
                </>
              ) : (
                <>
                  <a
                    href={`https://robinhood.com/stocks/${ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    Robinhood
                  </a>
                  <a
                    href={`https://www.interactivebrokers.com/en/index.php?f=2222&exch=smart&ticker=${ticker}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <ExternalLink size={12} />
                    IBKR
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* Price Chart */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="w-[2px] h-5 bg-[var(--accent)] inline-block" />
            <h2 className="text-lg text-[var(--text-secondary)]">Price Chart</h2>
          </div>

          {/* Time range selector */}
          <div className="flex items-center gap-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => handleRangeChange(r.label, r.days)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  activeRange === r.label
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-subtle)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {candleData.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No historical data available.</p>
        ) : (
          <CandlestickChart data={candleData} volumeData={volumeData} height={400} />
        )}
      </motion.div>

      {/* Company Fundamentals (stocks only) */}
      {!isCrypto && profile && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.07 }}
          className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
        >
          <div className="flex items-center gap-3 mb-5">
            <span className="w-[2px] h-5 bg-emerald-500 inline-block" />
            <h2 className="text-lg text-[var(--text-secondary)]">Company Fundamentals</h2>
          </div>

          {/* Company header */}
          <div className="flex items-center gap-3 flex-wrap mb-5">
            <h3 className="text-[var(--text-primary)] font-semibold text-base">{profile.name}</h3>
            {profile.sector && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                {profile.sector}
              </span>
            )}
            {profile.industry && (
              <span className="text-xs text-[var(--text-muted)]">{profile.industry}</span>
            )}
            {profile.exchange && (
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                {profile.exchange}
              </span>
            )}
          </div>

          {/* Key stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Market Cap', value: formatLargeNumber(profile.marketCap) },
              {
                label: 'P/E Ratio',
                value: financials[0]?.peRatio != null ? formatRatio(financials[0].peRatio) : '--',
              },
              {
                label: 'EPS',
                value: financials[0]?.eps != null ? `$${financials[0].eps.toFixed(2)}` : '--',
              },
              { label: 'Gross Margin', value: formatPercent(financials[0]?.grossMargin) },
              { label: 'Net Margin', value: formatPercent(financials[0]?.netMargin) },
              { label: 'Revenue Growth', value: formatPercent(financials[0]?.revenueGrowth) },
              { label: 'Current Ratio', value: formatRatio(financials[0]?.currentRatio) },
              { label: 'D/E Ratio', value: formatRatio(financials[0]?.debtToEquity) },
            ].map((item) => (
              <div key={item.label} className="bg-[var(--bg-elevated)] rounded p-3">
                <p className="text-[var(--text-muted)] text-xs">{item.label}</p>
                <p className="text-[var(--text-primary)] font-semibold font-data tabular-nums mt-0.5 text-sm">
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          {/* Company description */}
          {profile.description && (
            <div className="mb-5">
              <p
                className={`text-sm text-[var(--text-secondary)] leading-relaxed ${!descExpanded ? 'line-clamp-3' : ''}`}
              >
                {profile.description}
              </p>
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:text-blue-400 transition-colors"
              >
                {descExpanded ? (
                  <>
                    Show less <ChevronUp size={12} />
                  </>
                ) : (
                  <>
                    Show more <ChevronDown size={12} />
                  </>
                )}
              </button>
            </div>
          )}

          {/* Financials table */}
          {financials.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left py-2 pr-4 text-[var(--text-muted)] text-xs font-medium">
                      Period
                    </th>
                    <th className="text-right py-2 px-4 text-[var(--text-muted)] text-xs font-medium">
                      Revenue
                    </th>
                    <th className="text-right py-2 px-4 text-[var(--text-muted)] text-xs font-medium">
                      Net Income
                    </th>
                    <th className="text-right py-2 px-4 text-[var(--text-muted)] text-xs font-medium">
                      Gross Margin
                    </th>
                    <th className="text-right py-2 pl-4 text-[var(--text-muted)] text-xs font-medium">
                      Net Margin
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {financials.map((fm) => (
                    <tr key={fm.fiscalPeriod} className="border-b border-[var(--border-subtle)]/50">
                      <td className="py-2 pr-4 text-[var(--text-primary)] font-data">
                        {fm.fiscalPeriod}
                      </td>
                      <td className="py-2 px-4 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {formatLargeNumber(fm.revenue)}
                      </td>
                      <td className="py-2 px-4 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {formatLargeNumber(fm.netIncome)}
                      </td>
                      <td className="py-2 px-4 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {formatPercent(fm.grossMargin)}
                      </td>
                      <td className="py-2 pl-4 text-right text-[var(--text-secondary)] font-data tabular-nums">
                        {formatPercent(fm.netMargin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* AI Stock Analysis */}
      <StockAnalysisSection ticker={ticker!} currentPrice={quote?.close ?? null} />

      {/* AI News Brief */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="w-[2px] h-5 bg-purple-500 inline-block" />
          <Sparkles size={16} className="text-purple-400" />
          <h2 className="text-lg text-[var(--text-secondary)]">AI News Brief</h2>
          {summary && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-300">
              {summary.articleCount} articles analyzed
            </span>
          )}
        </div>

        {summaryLoading ? (
          <div className="space-y-2">
            <div className="h-4 bg-[var(--bg-elevated)] rounded animate-pulse w-full" />
            <div className="h-4 bg-[var(--bg-elevated)] rounded animate-pulse w-5/6" />
            <div className="h-4 bg-[var(--bg-elevated)] rounded animate-pulse w-4/6" />
          </div>
        ) : summary?.summary ? (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{summary.summary}</p>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            No news summary available for {ticker}.
          </p>
        )}
      </motion.div>

      {/* Related News */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-[var(--bg-panel)] rounded p-6 border border-[var(--border-subtle)]"
      >
        <div className="flex items-center gap-3 mb-5">
          <span className="w-[2px] h-5 bg-[var(--accent)] inline-block" />
          <h2 className="text-lg text-[var(--text-secondary)]">Related News</h2>
        </div>

        {loading ? (
          <p className="text-[var(--text-muted)] text-sm">Loading news...</p>
        ) : news.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No news found for {ticker}.</p>
        ) : (
          <div className="space-y-3">
            {news.map((item, i) => (
              <motion.a
                key={item.id}
                href={item.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start justify-between gap-4 p-3 rounded bg-[var(--bg-elevated)] hover:border-[var(--border-subtle)] border border-transparent hover:border-[color:var(--border-subtle)] transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-[var(--text-primary)] text-sm font-medium truncate group-hover:text-[var(--accent)] transition-colors">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs ${SOURCE_COLORS[item.source] ?? 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}
                    >
                      {SOURCE_LABELS[item.source] ?? item.source}
                    </span>
                    {item.sentiment && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          item.sentiment.toUpperCase() === 'POSITIVE'
                            ? 'bg-[color:var(--up)]/15 text-[color:var(--up)]'
                            : item.sentiment.toUpperCase() === 'NEGATIVE'
                              ? 'bg-[color:var(--down)]/15 text-[color:var(--down)]'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {item.sentiment.charAt(0).toUpperCase() +
                          item.sentiment.slice(1).toLowerCase()}
                      </span>
                    )}
                    <span>
                      {new Date(item.publishedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {item.author && <span>by {item.author}</span>}
                  </div>
                </div>
                <ExternalLink
                  size={14}
                  className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] flex-shrink-0 mt-1"
                />
              </motion.a>
            ))}

            {hasMoreNews && (
              <button
                onClick={loadMoreNews}
                disabled={loadingMore}
                className="w-full text-center py-2 text-sm text-[var(--accent)] hover:text-blue-400 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
