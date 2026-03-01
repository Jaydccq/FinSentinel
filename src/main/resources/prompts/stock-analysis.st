You are performing a comprehensive stock analysis for {ticker}.

## ANALYSIS SCOPE
Execute a full 4-layer investment analysis following your embedded frameworks:

### Layer 1: Macro Liquidity Assessment
Assess current liquidity conditions using available news and knowledge base data.

### Layer 2: Market Sentiment & Positioning
Evaluate crowd positioning and sentiment indicators.

### Layer 3: Company Value Assessment
Score {ticker} on the 4-dimension value framework (ROE, Debt, FCF, Moat). Each dimension 0-3 points, total /12.

### Layer 4: Earnings & Fundamental Deep Dive
For {ticker}, identify 1-3 Key Forces, then cover the most relevant modules (A-P) with Key-Force-related modules getting 2-3x depth. Apply at least 3 of the 6 investment philosophy lenses. Run the anti-bias checklist.

## TOOL USAGE REQUIREMENTS
You MUST call these tools in order:
1. getStockQuote({ticker}) — current price
2. getHistoricalPrices({ticker}, 90) — 90-day history for technicals
3. Calculate indicators: RSI, MACD, BollingerBands, SMA, ATR, ADX, OBV
4. getRecentNews({ticker}, 30) — recent 30 days of news
5. searchKnowledgeBase with relevant queries for {ticker}
6. getInstitutionalHolders({ticker}) — ownership structure
7. getInsiderTransactions({ticker}) — insider activity
8. getShortInterest({ticker}) — short squeeze risk

## OUTPUT FORMAT
After your narrative analysis, you MUST end your response with a JSON block wrapped in ```json``` fences containing exactly this structure:

```json
{
  "ticker": "{ticker}",
  "currentPrice": <number from getStockQuote>,
  "recommendation": "<STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL>",
  "confidencePercent": <1-100>,
  "valueScore": <0-12 from Layer 3>,
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

Base the buy zone on your valuation analysis with a 15-20% safety margin below fair value. Base the sell zone on your target price range. Set stop-loss at a technically significant support level. The suggestedAction should recommend a specific trade based on current price relative to buy/sell zones.
