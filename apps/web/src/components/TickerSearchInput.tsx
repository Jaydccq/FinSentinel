import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Bitcoin, TrendingUp, Layers } from 'lucide-react';
import { marketApi, type TickerSearchResult } from '../api/market';

const ASSET_ICON: Record<string, React.ReactNode> = {
  CRYPTOCURRENCY: <Bitcoin size={13} className="text-orange-400" />,
  ETF: <Layers size={13} className="text-blue-400" />,
  EQUITY: <TrendingUp size={13} className="text-[var(--up)]" />,
};

const POPULAR_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'META', name: 'Meta Platforms' },
];

const POPULAR_CRYPTO = [
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'SOL-USD', name: 'Solana' },
  { symbol: 'XRP-USD', name: 'Ripple' },
];

interface Props {
  onSelect: (result: { symbol: string; name: string; assetType?: string }) => void;
  placeholder?: string;
  excludeSymbols?: string[];
}

export default function TickerSearchInput({
  onSelect,
  placeholder = 'Search stocks or crypto...',
  excludeSymbols = [],
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(
    (q: string) => {
      if (q.length < 1) {
        setResults([]);
        return;
      }
      setLoading(true);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        marketApi
          .search(q, 8)
          .then((r) => setResults(r.filter((item) => !excludeSymbols.includes(item.symbol))))
          .catch(() => setResults([]))
          .finally(() => setLoading(false));
      }, 300);
    },
    [excludeSymbols],
  );

  useEffect(() => {
    doSearch(query); // eslint-disable-line react-hooks/set-state-in-effect -- debounced API search
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (item: { symbol: string; name: string; assetType?: string }) => {
    onSelect(item);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const excludeSet = new Set(excludeSymbols);
  const filteredPopularStocks = POPULAR_STOCKS.filter((s) => !excludeSet.has(s.symbol));
  const filteredPopularCrypto = POPULAR_CRYPTO.filter((s) => !excludeSet.has(s.symbol));
  const showPopular = query.length === 0 && open;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          className="field-input pl-9 pr-3 py-2 text-sm w-full"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>

      {open && (showPopular || results.length > 0 || loading) && (
        <div className="absolute z-50 top-full mt-1 w-full bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded shadow-2xl shadow-black/60 max-h-72 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              Searching...
            </div>
          )}

          {!loading &&
            results.length > 0 &&
            results.map((r) => (
              <button
                key={r.symbol}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-500/10 transition-colors text-left border-b border-[var(--border-subtle)] last:border-0"
              >
                <span className="flex-shrink-0">
                  {ASSET_ICON[r.assetType] ?? ASSET_ICON.EQUITY}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {r.symbol}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] ml-2 truncate">
                    {r.name}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] uppercase">{r.exchange}</span>
              </button>
            ))}

          {!loading && results.length === 0 && query.length >= 1 && (
            <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]">No results found</div>
          )}

          {showPopular && (
            <>
              <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold border-b border-[var(--border-subtle)]">
                Popular Stocks
              </div>
              {filteredPopularStocks.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => handleSelect({ ...s, assetType: 'EQUITY' })}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-500/10 transition-colors text-left border-b border-[var(--border-subtle)] last:border-0"
                >
                  <TrendingUp size={13} className="text-[var(--up)] flex-shrink-0" />
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {s.symbol}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{s.name}</span>
                </button>
              ))}
              <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold border-b border-[var(--border-subtle)]">
                Popular Crypto
              </div>
              {filteredPopularCrypto.map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => handleSelect({ ...s, assetType: 'CRYPTOCURRENCY' })}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-500/10 transition-colors text-left border-b border-[var(--border-subtle)] last:border-0"
                >
                  <Bitcoin size={13} className="text-orange-400 flex-shrink-0" />
                  <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                    {s.symbol}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{s.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
