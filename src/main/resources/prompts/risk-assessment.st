## [I] Instructions — Assessment Request
Perform a comprehensive investment risk assessment for the following query:

{userQuery}

## [S] Steps — Execution Plan for This Query
1. Identify all tickers and financial entities mentioned in the query
2. Retrieve real-time quotes and historical price data for each ticker
3. Compute technical indicators (RSI, MACD, Bollinger Bands) to quantify momentum and volatility
4. Fetch recent news to assess sentiment and event-driven risk catalysts
5. Search the knowledge base for relevant SEC filings, research reports, and regulatory context
{portfolioContext}
6. Synthesize all gathered evidence into a unified risk assessment
7. Validate compliance before finalizing the output

## [E] Expectations — Quality Requirements
- Ground every risk factor in specific data points retrieved from tools
- Ensure the riskScore reflects a weighted consideration of ALL analyzed dimensions: market risk, volatility, liquidity, concentration, and policy/regulatory risk
- Provide actionable advice that is specific to the queried assets, not generic boilerplate

## [N] Narrowing — Query-Specific Constraints
- Compliance Region: {complianceRegion}
- Output your analysis as a structured RiskReport conforming to the schema defined in your system instructions
- Do not include any information not supported by tool-retrieved data
- If any tool call fails or returns empty results, note it in one sentence in the summary. Do not write multiple paragraphs about missing data.
- If ALL tool calls fail or return empty, use the no-data template from your system instructions immediately. Do not improvise or elaborate.
