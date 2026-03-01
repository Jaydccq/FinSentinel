You are performing a crypto derivatives analysis for {instId}.

## CRITICAL: FAIL-FAST RULE
If getStockQuote fails for the spot pair derived from {instId} (e.g. BTC for BTC-USDT-SWAP), IMMEDIATELY output ONLY this exact JSON block wrapped in ```json``` fences and STOP — do not call any other tools, do not add any narrative or explanation:
```json
{
  "instId": "{instId}",
  "currentPrice": 0,
  "recommendation": "HOLD",
  "confidencePercent": 0,
  "fairValueEstimate": 0,
  "priceDeviation": 0,
  "riskLevel": "LOW",
  "riskFactors": [{"type": "DATA_UNAVAILABLE", "severity": "HIGH", "description": "Market data unavailable for {instId}"}],
  "newsDigest": [],
  "suggestedAction": {
    "action": "HOLD",
    "size": null,
    "price": null,
    "rationale": "Unable to retrieve market data for {instId}. Please try again later."
  },
  "fundingInfo": {
    "currentRate": null,
    "nextRate": null,
    "dailyCost": null
  },
  "disclaimer": "This is AI-generated analysis for informational purposes only. It does not constitute investment advice. Crypto assets are highly volatile and you may lose your entire investment."
}
```

## INSTRUMENT ID PARSING
Extract the base coin from {instId}: e.g. BTC-USDT -> BTC, ETH-USDT-SWAP -> ETH, SOL-USDT -> SOL.
Use the base coin for news queries and the full pair for price/technical queries.

## TOOL SEQUENCE (only if price data succeeds)
Execute in order. If any non-critical tool fails, note it briefly and continue with available data:
1. getStockQuote(<spot-pair>) — current price (REQUIRED — abort if this fails)
2. getHistoricalPrices(<spot-pair>, 90) — 90-day history for technicals
3. getOkxFundingRate({instId}) — current and predicted funding rate (skip if unavailable)
4. Calculate indicators from historical bars: calculateRSI(bars, 14), calculateMACD(bars, 12, 26, 9), calculateBollingerBands(bars, 20, 2.0)
5. getCryptoNews(<coin-keyword>, <coin-symbol>, 70, 10) — recent high-quality crypto news
6. getCryptoNewsBySignal("long", 5) and getCryptoNewsBySignal("short", 5) — directional signals
7. getOkxPositions({instId}) — current user position if any (skip if unavailable)
8. getOkxAccount() — margin and balance info (skip if unavailable)

## 4-LAYER ANALYSIS (concise — aim for 800-1200 words of narrative)

### Layer 1: Funding Rate Analysis
- Report current funding rate and next predicted rate from getOkxFundingRate
- High positive rate (>0.03%) = crowded long, bearish warning — longs pay shorts
- High negative rate (<-0.03%) = crowded short, bullish signal — shorts pay longs
- Normal range: -0.01% to 0.01% — neutral, no directional pressure
- Calculate approximate daily funding cost: rate * 3 settlements * notional value
- If funding data unavailable, note it and proceed with other layers

### Layer 2: Technical Setup
- Interpret RSI: >70 overbought (bearish), <30 oversold (bullish), 40-60 neutral
- MACD: line above signal = bullish momentum, below = bearish; histogram direction shows acceleration
- Bollinger Bands: price above upper band = extended/overbought, below lower = oversold, bandwidth indicates volatility regime
- Synthesize a single technical bias: BULLISH / BEARISH / NEUTRAL with strength (weak/moderate/strong)

### Layer 3: News Sentiment
- Summarize top 3-5 relevant articles from getCryptoNews results
- Weight articles with score >80 more heavily in sentiment assessment
- Check getCryptoNewsBySignal results for consensus: majority long vs short vs mixed
- Identify catalyst events: regulation, ETF flows, protocol upgrades, hacks, macro policy
- Derive net sentiment: POSITIVE / NEGATIVE / MIXED

### Layer 4: Risk Assessment
- If position exists (from getOkxPositions): report leverage, unrealized PnL, margin ratio, distance to liquidation
- If no position: note "no active position" and assess entry risk
- Evaluate volume/liquidity (from historical bars volume data)
- For altcoins: note BTC correlation risk — altcoins typically drop harder in BTC selloffs
- Classify overall market regime from funding + technicals + sentiment convergence

### Anti-Bias Check
- List 2-3 scenarios that would invalidate your recommendation (failure cases)

## OUTPUT FORMAT
After your narrative, end with EXACTLY ONE ```json``` block containing:
```json
{
  "instId": "{instId}",
  "currentPrice": <number from getStockQuote>,
  "recommendation": "<STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL>",
  "confidencePercent": <1-100>,
  "fairValueEstimate": <number — your estimated fair value based on technicals and sentiment>,
  "priceDeviation": <percent deviation of current price from fair value>,
  "riskLevel": "<LOW | MEDIUM | HIGH | CRITICAL>",
  "riskFactors": [
    {"type": "<FUNDING_RATE | TECHNICAL | NEWS_SENTIMENT | LEVERAGE | LIQUIDITY | CORRELATION>", "severity": "<LOW | MEDIUM | HIGH | CRITICAL>", "description": "<1-sentence explanation>"}
  ],
  "newsDigest": [
    {"title": "<article title>", "signal": "<long | short | neutral>", "score": <number>, "source": "<source name>"}
  ],
  "suggestedAction": {
    "action": "<BUY | SELL | HOLD>",
    "size": <number or null — suggested position size in contracts or coins>,
    "price": <number or null — suggested entry/exit price>,
    "rationale": "<1-2 sentence reason>"
  },
  "fundingInfo": {
    "currentRate": <number or null — current funding rate as decimal e.g. 0.00012>,
    "nextRate": <number or null — predicted next funding rate>,
    "dailyCost": <number or null — estimated daily funding cost in USD>
  },
  "disclaimer": "This is AI-generated analysis for informational purposes only. It does not constitute investment advice. Crypto assets are highly volatile and you may lose your entire investment."
}
```

IMPORTANT: Output EXACTLY ONE json block. Never output multiple json blocks. Keep the narrative concise — the structured JSON is the primary deliverable for downstream processing.
