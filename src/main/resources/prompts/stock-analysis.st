You are performing a one-click stock analysis for {ticker}.

## CRITICAL: FAIL-FAST RULE
If getStockQuote({ticker}) returns an error or empty data, IMMEDIATELY output ONLY this exact JSON block wrapped in ```json``` fences and STOP — do not call any other tools, do not add any narrative or explanation:
```json
{
  "ticker": "{ticker}",
  "currentPrice": 0,
  "recommendation": "HOLD",
  "confidencePercent": 0,
  "valueScore": 0,
  "valueRating": "D",
  "buyZone": { "low": 0, "high": 0 },
  "sellZone": { "low": 0, "high": 0 },
  "stopLoss": 0,
  "targetPrice": 0,
  "impliedUpside": 0,
  "riskLevel": "LOW",
  "keyForces": ["Market data unavailable"],
  "suggestedAction": {
    "action": "HOLD",
    "shares": null,
    "amount": null,
    "rationale": "Unable to retrieve market data for {ticker}. Please try again later."
  },
  "disclaimer": "This analysis is for informational purposes only and does not constitute investment advice. Past performance does not guarantee future results."
}
```

## TOOL SEQUENCE (only if getStockQuote succeeds)
Execute in order. If any non-critical tool fails, note it briefly and continue with available data:
1. getStockQuote({ticker}) — current price (REQUIRED — abort if this fails)
2. getHistoricalPrices({ticker}, 90) — 90-day history for technicals
3. Calculate indicators: RSI, MACD, BollingerBands, SMA, ATR
4. getRecentNews({ticker}, 30) — recent 30 days of news
5. searchKnowledgeBase with relevant queries for {ticker}

## ANALYSIS SCOPE (concise — aim for 800-1200 words of narrative)
Write a single cohesive analysis covering:
- **Macro context**: Current liquidity/sentiment conditions (2-3 sentences)
- **Technical picture**: Key indicator signals from tool results (1 paragraph)
- **Value assessment**: Score on ROE/Debt/FCF/Moat framework, total /12 (1 paragraph)
- **Key forces**: 1-3 decisive factors for this stock (1 paragraph each)
- **Anti-bias**: 2-3 failure scenarios in bullet points

## OUTPUT FORMAT
After your narrative, end with EXACTLY ONE ```json``` block containing:
```json
{
  "ticker": "{ticker}",
  "currentPrice": <number from getStockQuote>,
  "recommendation": "<STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL>",
  "confidencePercent": <1-100>,
  "valueScore": <0-12>,
  "valueRating": "<A | B | C | D>",
  "buyZone": { "low": <number>, "high": <number> },
  "sellZone": { "low": <number>, "high": <number> },
  "stopLoss": <number>,
  "targetPrice": <number>,
  "impliedUpside": <percent number>,
  "riskLevel": "<LOW | MEDIUM | HIGH | CRITICAL>",
  "keyForces": ["<force1>", "<force2>"],
  "suggestedAction": {
    "action": "<BUY | SELL | HOLD>",
    "shares": <number or null>,
    "amount": <dollar amount or null>,
    "rationale": "<1-2 sentence reason>"
  },
  "disclaimer": "This analysis is for informational purposes only and does not constitute investment advice. Past performance does not guarantee future results."
}
```

IMPORTANT: Output EXACTLY ONE json block. Never output multiple json blocks. Never output RiskReport schema fields (riskScore, factors, complianceNote) — those belong to a different endpoint.
