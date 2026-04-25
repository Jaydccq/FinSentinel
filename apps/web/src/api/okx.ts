import { apiFetch, resolveBase, authHeaders, withCsrfHeader } from './client';

// ---- Types ----

export interface OkxAccountInfo {
  cash: number;
  portfolioValue: number;
  equity: number;
  buyingPower: number;
  unrealizedPnL: number;
  realizedPnL: number;
}

export interface OkxPositionInfo {
  symbol: string;
  side: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  costBasis: number;
}

export interface OkxFundingRate {
  instId: string;
  instType: string;
  fundingRate: string;
  nextFundingRate: string;
  fundingTime: string;
  nextFundingTime: string;
}

export interface OkxOrder {
  instId: string;
  ordId: string;
  clOrdId: string;
  side: string;
  ordType: string;
  posSide: string;
  sz: string;
  px: string;
  avgPx: string;
  accFillSz: string;
  state: string;
  tdMode: string;
  lever: string;
  fee: string;
  pnl: string;
  cTime: string;
  uTime: string;
}

export interface OkxBalanceDetail {
  ccy: string;
  eq: string;
  cashBal: string;
  availBal: string;
  frozenBal: string;
  upl: string;
  disEq: string;
}

export interface OkxTicker {
  instId: string;
  instType: string;
  last: string;
  askPx: string;
  bidPx: string;
  open24h: string;
  high24h: string;
  low24h: string;
  vol24h: string;
  ts: string;
}

export interface CryptoAnalysisResult {
  instId: string;
  currentPrice: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidencePercent: number;
  fairValueEstimate: number;
  priceDeviation: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskFactors: Array<{ type: string; severity: string; description: string }>;
  newsDigest: Array<{ title: string; signal: string; score: number; source: string }>;
  suggestedAction: { action: string; size: number | null; price: number | null; rationale: string };
  fundingInfo: { currentRate: number; nextRate: number; dailyCost: number };
  disclaimer: string;
}

// ---- Helpers ----

function isValidCryptoResult(v: unknown): v is CryptoAnalysisResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.instId === 'string' &&
    typeof o.currentPrice === 'number' &&
    typeof o.recommendation === 'string' &&
    typeof o.confidencePercent === 'number' &&
    typeof o.riskLevel === 'string' &&
    o.suggestedAction != null &&
    typeof (o.suggestedAction as Record<string, unknown>).action === 'string'
  );
}

export function parseCryptoAnalysisResult(fullText: string): CryptoAnalysisResult | null {
  const match = fullText.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return isValidCryptoResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---- API Functions ----

export const okxApi = {
  account: () => apiFetch<OkxAccountInfo>('/okx/account'),

  positions: () => apiFetch<OkxPositionInfo[]>('/okx/positions'),

  pendingOrders: () => apiFetch<OkxOrder[]>('/okx/orders/pending'),

  orderHistory: (instType = 'SPOT') =>
    apiFetch<OkxOrder[]>(`/okx/orders/history?instType=${encodeURIComponent(instType)}`),

  fundingRate: (instId: string) =>
    apiFetch<OkxFundingRate>(`/okx/funding-rate/${encodeURIComponent(instId)}`),

  balanceDetails: () => apiFetch<OkxBalanceDetail[]>('/okx/balance/details'),

  ticker: (instId: string) => apiFetch<OkxTicker>(`/okx/ticker/${encodeURIComponent(instId)}`),

  // SSE streaming analysis -- same pattern as analysisApi.stream in analysis.ts
  streamAnalysis: async (
    instId: string,
    onChunk: (text: string) => void,
    onDone: (fullText: string, result?: CryptoAnalysisResult) => void,
    onError: (err: string) => void,
  ): Promise<void> => {
    try {
      const res = await fetch(
        `${resolveBase()}/okx/analysis/stream/${encodeURIComponent(instId)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrfHeader('POST', {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...authHeaders(),
          }),
        },
      );

      if (!res.ok) {
        onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let receivedDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventName = '';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (eventName === 'done') {
              receivedDone = true;
              onDone(fullText, parseCryptoAnalysisResult(fullText) ?? undefined);
            } else if (eventName === 'error') {
              receivedDone = true;
              try {
                onError(JSON.parse(data).message);
              } catch {
                onError(data);
              }
            } else if (eventName === 'message') {
              try {
                const parsed = JSON.parse(data);
                const content = parsed.content ?? '';
                fullText += content;
                onChunk(content);
              } catch {
                /* ignore malformed */
              }
            }
          } else if (line === '') {
            eventName = '';
          }
        }
      }

      // Fallback: if stream ended without a done/error event, still resolve
      if (!receivedDone) {
        if (fullText) {
          onDone(fullText, parseCryptoAnalysisResult(fullText) ?? undefined);
        } else {
          onError('Stream ended unexpectedly');
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Connection failed');
    }
  },

  // SSE streaming health check -- same SSE pattern
  streamHealthCheck: async (
    onChunk: (text: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: string) => void,
  ): Promise<void> => {
    try {
      const res = await fetch(`${resolveBase()}/okx/analysis/health`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrfHeader('POST', {
          'Content-Type': 'application/json',
          ...authHeaders(),
        }),
      });

      if (!res.ok) {
        onError(`HTTP ${res.status}`);
        return;
      }

      const payload = (await res.json()) as {
        status?: string;
        message?: string;
        lastPrice?: string;
      };

      const narrative = payload.lastPrice
        ? `${payload.message ?? 'OKX API responded'} Last BTC-USDT-SWAP price: ${payload.lastPrice}.`
        : (payload.message ?? 'OKX health check completed.');

      onChunk(narrative);
      onDone(narrative);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Connection failed');
    }
  },
};
