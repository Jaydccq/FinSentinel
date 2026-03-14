package com.example.finsentinel.service.research;

import com.example.finsentinel.config.YahooFinanceProperties;
import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Research data provider backed by Yahoo Finance's free v10 quoteSummary API.
 *
 * <p>Provides company profile and financial statement data without requiring
 * an API key, making it the most accessible research data source for any user.
 *
 * <p>Implements the three-phase pipeline:
 * <ul>
 *   <li><b>transformQuery</b> -- ticker normalization (uppercase, trim)</li>
 *   <li><b>extractData</b> -- calls Yahoo Finance v10 quoteSummary endpoint</li>
 *   <li><b>transformData</b> -- maps Yahoo's {@code {raw, fmt}} JSON format
 *       into standardized {@link CompanyProfile} and {@link FinancialMetrics} records</li>
 * </ul>
 *
 * <p>Yahoo Finance blocks requests without a proper {@code User-Agent} header,
 * so every request includes a browser-like user agent string. All responses are
 * cached in Redis to reduce API usage and improve latency.
 */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "app.yahoo-finance.enabled", havingValue = "true", matchIfMissing = true)
public class YFinanceResearchProvider implements ResearchDataProvider {

    private static final String USER_AGENT = "Mozilla/5.0 (compatible; FinSentinel/1.0)";
    private static final int SCALE = 2;

    private static final Duration PROFILE_TTL = Duration.ofHours(24);
    private static final Duration FINANCIALS_TTL = Duration.ofHours(6);

    private final RestClient restClient;
    private final YahooFinanceProperties yahooProperties;
    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redisTemplate;

    @Override
    public String getName() {
        return "yfinance";
    }

    // ──────────────────────────── Company Profile ────────────────────────────

    @Override
    public CompanyProfile getCompanyProfile(String ticker) {
        ticker = ticker.toUpperCase().trim();
        String cacheKey = "yf:profile:" + ticker;

        // Check cache
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            CompanyProfile parsed = parseProfile(cached);
            if (parsed != null) {
                log.debug("Cache hit for Yahoo Finance company profile: {}", ticker);
                return parsed;
            }
            redisTemplate.delete(cacheKey);
            log.warn("Evicted corrupted YF profile cache for {}", ticker);
        }

        // Call Yahoo Finance API
        try {
            JsonNode result = fetchQuoteSummary(ticker, "assetProfile,price,summaryDetail");
            if (result == null) {
                log.warn("No profile data returned from Yahoo Finance for {}", ticker);
                return null;
            }

            JsonNode assetProfile = result.path("assetProfile");
            JsonNode price = result.path("price");

            CompanyProfile profile = new CompanyProfile(
                    ticker,
                    price.path("shortName").asText("Unknown"),
                    assetProfile.path("longBusinessSummary").asText("No description available"),
                    assetProfile.path("sector").asText("Unknown"),
                    assetProfile.path("industry").asText("Unknown"),
                    assetProfile.path("website").asText(""),
                    rawValue(price, "marketCap") != null
                            ? rawValue(price, "marketCap") : BigDecimal.ZERO,
                    assetProfile.path("fullTimeEmployees").asInt(0),
                    "N/A",  // Yahoo Finance does not provide IPO date in assetProfile
                    price.path("exchangeName").asText("Unknown")
            );

            // Cache result
            cacheJson(cacheKey, objectMapper.writeValueAsString(profile), PROFILE_TTL);
            log.info("Fetched Yahoo Finance company profile for {}", ticker);
            return profile;

        } catch (Exception e) {
            log.error("Failed to fetch Yahoo Finance company profile for {}", ticker, e);
            return null;
        }
    }

    // ──────────────────────────── Financial Metrics ──────────────────────────

    @Override
    public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) {
        ticker = ticker.toUpperCase().trim();
        periods = Math.min(Math.max(periods, 1), 10);
        String cacheKey = "yf:financials:" + ticker + ":" + periods;

        // Check cache
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            List<FinancialMetrics> parsed = parseFinancialsList(cached);
            if (parsed != null && !parsed.isEmpty()) {
                log.debug("Cache hit for Yahoo Finance financials: {}", ticker);
                return parsed;
            }
            redisTemplate.delete(cacheKey);
            log.warn("Evicted corrupted YF financials cache for {}", ticker);
        }

        // Call Yahoo Finance API
        try {
            JsonNode result = fetchQuoteSummary(ticker,
                    "incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory");
            if (result == null) {
                log.warn("No financial data returned from Yahoo Finance for {}", ticker);
                return List.of();
            }

            JsonNode incomeStatements = result
                    .path("incomeStatementHistory")
                    .path("incomeStatementHistory");
            JsonNode balanceSheets = result
                    .path("balanceSheetHistory")
                    .path("balanceSheetStatements");
            JsonNode cashFlows = result
                    .path("cashflowStatementHistory")
                    .path("cashflowStatements");

            if (incomeStatements.isMissingNode() || incomeStatements.isEmpty()) {
                log.warn("No income statement data from Yahoo Finance for {}", ticker);
                return List.of();
            }

            int available = Math.min(incomeStatements.size(), periods);

            // Process oldest-to-newest for YoY growth calculation, then reverse
            List<FinancialMetrics> metricsList = new ArrayList<>();
            BigDecimal previousRevenue = null;

            for (int i = available - 1; i >= 0; i--) {
                JsonNode income = incomeStatements.get(i);
                JsonNode balance = i < balanceSheets.size() ? balanceSheets.get(i) : null;
                JsonNode cashFlow = i < cashFlows.size() ? cashFlows.get(i) : null;

                FinancialMetrics metrics = parseStatementToMetrics(
                        ticker, income, balance, cashFlow, previousRevenue);
                if (metrics != null) {
                    metricsList.addFirst(metrics);
                    previousRevenue = metrics.revenue();
                }
            }

            // Cache result
            cacheJson(cacheKey, objectMapper.writeValueAsString(metricsList), FINANCIALS_TTL);
            log.info("Fetched {} financial periods from Yahoo Finance for {}",
                    metricsList.size(), ticker);
            return metricsList;

        } catch (Exception e) {
            log.error("Failed to fetch Yahoo Finance financials for {}", ticker, e);
            return List.of();
        }
    }

    // ──────────────────────────── extractData ────────────────────────────────

    /**
     * Calls the Yahoo Finance v10 quoteSummary API and extracts the first result node.
     *
     * <p>The response structure is:
     * <pre>{@code
     * { "quoteSummary": { "result": [ { ... } ], "error": null } }
     * }</pre>
     *
     * @param ticker  ticker symbol
     * @param modules comma-separated module names
     * @return the first element of {@code quoteSummary.result}, or {@code null} if empty
     */
    JsonNode fetchQuoteSummary(String ticker, String modules) {
        String url = yahooProperties.getBaseUrl()
                + "/v10/finance/quoteSummary/" + ticker
                + "?modules=" + modules;

        log.debug("Fetching Yahoo Finance quoteSummary: {}", url);

        String responseBody = restClient.get()
                .uri(url)
                .header("User-Agent", USER_AGENT)
                .retrieve()
                .body(String.class);

        if (responseBody == null || responseBody.isBlank()) {
            log.warn("Empty response from Yahoo Finance quoteSummary for {}", ticker);
            return null;
        }

        JsonNode root = objectMapper.readTree(responseBody);
        JsonNode quoteSummary = root.path("quoteSummary");

        // Check for API-level errors
        JsonNode error = quoteSummary.path("error");
        if (!error.isMissingNode() && !error.isNull()) {
            String errorMsg = error.has("description")
                    ? error.get("description").asText()
                    : error.toString();
            log.warn("Yahoo Finance API error for {}: {}", ticker, errorMsg);
            return null;
        }

        JsonNode resultArray = quoteSummary.path("result");
        if (resultArray.isMissingNode() || resultArray.isEmpty()) {
            return null;
        }

        return resultArray.get(0);
    }

    // ──────────────────────────── transformData ──────────────────────────────

    /**
     * Parses Yahoo Finance income statement, balance sheet, and cash flow nodes
     * into a single {@link FinancialMetrics} record.
     */
    private FinancialMetrics parseStatementToMetrics(String ticker,
                                                      JsonNode income,
                                                      JsonNode balance,
                                                      JsonNode cashFlow,
                                                      BigDecimal previousRevenue) {
        try {
            // Fiscal period from endDate
            String endDate = income.path("endDate").path("fmt").asText("");
            String fiscalPeriod = endDate.length() >= 4
                    ? "FY" + endDate.substring(0, 4)
                    : "Unknown";

            // Income statement
            BigDecimal revenue = rawValue(income, "totalRevenue");
            BigDecimal grossProfit = rawValue(income, "grossProfit");
            BigDecimal operatingIncome = rawValue(income, "operatingIncome");
            BigDecimal netIncome = rawValue(income, "netIncome");
            BigDecimal eps = rawValue(income, "basicEps");

            // If EPS not available, try to compute from netIncome / dilutedAverageShares
            if (eps == null && netIncome != null) {
                BigDecimal shares = rawValue(income, "dilutedAverageShares");
                if (shares == null) {
                    shares = rawValue(income, "basicAverageShares");
                }
                if (shares != null && shares.compareTo(BigDecimal.ZERO) != 0) {
                    eps = netIncome.divide(shares, SCALE, RoundingMode.HALF_UP);
                }
            }

            // Margins
            BigDecimal grossMargin = safeDividePercent(grossProfit, revenue);
            BigDecimal operatingMargin = safeDividePercent(operatingIncome, revenue);
            BigDecimal netMargin = safeDividePercent(netIncome, revenue);

            // Balance sheet
            BigDecimal totalAssets = balance != null ? rawValue(balance, "totalAssets") : null;
            BigDecimal totalLiabilities = balance != null ? rawValue(balance, "totalLiab") : null;
            BigDecimal totalEquity = balance != null
                    ? rawValue(balance, "totalStockholderEquity") : null;
            BigDecimal currentAssets = balance != null
                    ? rawValue(balance, "totalCurrentAssets") : null;
            BigDecimal currentLiabilities = balance != null
                    ? rawValue(balance, "totalCurrentLiabilities") : null;

            BigDecimal currentRatio = safeDivide(currentAssets, currentLiabilities);
            BigDecimal debtToEquity = safeDivide(totalLiabilities, totalEquity);

            // Valuation (PE and PB — skipped without live price, consistent with Yahoo data scope)
            BigDecimal peRatio = null;
            BigDecimal pbRatio = null;

            // Revenue growth (YoY)
            BigDecimal revenueGrowth = null;
            if (revenue != null && previousRevenue != null
                    && previousRevenue.compareTo(BigDecimal.ZERO) != 0) {
                revenueGrowth = revenue.subtract(previousRevenue)
                        .divide(previousRevenue.abs(), 4, RoundingMode.HALF_UP)
                        .multiply(BigDecimal.valueOf(100))
                        .setScale(SCALE, RoundingMode.HALF_UP);
            }

            // Cash flow
            BigDecimal operatingCashFlow = cashFlow != null
                    ? rawValue(cashFlow, "totalCashFromOperatingActivities") : null;
            BigDecimal capex = cashFlow != null
                    ? rawValue(cashFlow, "capitalExpenditures") : null;
            BigDecimal freeCashFlow = null;
            if (operatingCashFlow != null && capex != null) {
                // capex from Yahoo is typically negative; FCF = operating + capex
                freeCashFlow = operatingCashFlow.add(capex)
                        .setScale(SCALE, RoundingMode.HALF_UP);
            }

            return new FinancialMetrics(
                    ticker, "annual", fiscalPeriod,
                    revenue, netIncome, eps,
                    grossMargin, operatingMargin, netMargin,
                    totalAssets, totalLiabilities, totalEquity,
                    currentRatio, debtToEquity,
                    peRatio, pbRatio, revenueGrowth,
                    operatingCashFlow, freeCashFlow, capex
            );

        } catch (Exception e) {
            log.warn("Failed to parse Yahoo Finance statement for {}: {}", ticker, e.getMessage());
            return null;
        }
    }

    // ──────────────────────────── Helpers ─────────────────────────────────────

    /**
     * Safely extracts the raw numeric value from Yahoo Finance's
     * {@code {raw: N, fmt: "..."}} format.
     *
     * @param parent parent JSON node
     * @param field  field name
     * @return the raw value as {@link BigDecimal}, or {@code null} if missing
     */
    BigDecimal rawValue(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        if (node.isMissingNode() || !node.has("raw")) {
            return null;
        }
        return BigDecimal.valueOf(node.get("raw").asDouble())
                .setScale(SCALE, RoundingMode.HALF_UP);
    }

    /**
     * Safely divides numerator by denominator, returning {@code null} if either
     * is null or denominator is zero.
     */
    private BigDecimal safeDivide(BigDecimal numerator, BigDecimal denominator) {
        if (numerator == null || denominator == null
                || denominator.compareTo(BigDecimal.ZERO) == 0) {
            return null;
        }
        return numerator.divide(denominator, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * Divides numerator by denominator and multiplies by 100 to produce a percentage.
     */
    private BigDecimal safeDividePercent(BigDecimal numerator, BigDecimal denominator) {
        BigDecimal ratio = safeDivide(numerator, denominator);
        if (ratio == null) return null;
        return ratio.multiply(BigDecimal.valueOf(100)).setScale(SCALE, RoundingMode.HALF_UP);
    }

    // ──────────────────────────── Cache Helpers ──────────────────────────────

    private void cacheJson(String key, String json, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(key, json, ttl);
        } catch (Exception e) {
            log.warn("Failed to cache YF research data for key {}: {}", key, e.getMessage());
        }
    }

    private CompanyProfile parseProfile(String json) {
        try {
            return objectMapper.readValue(json, CompanyProfile.class);
        } catch (JacksonException e) {
            log.warn("Failed to parse cached YF company profile", e);
            return null;
        }
    }

    private List<FinancialMetrics> parseFinancialsList(String json) {
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(
                            List.class, FinancialMetrics.class));
        } catch (JacksonException e) {
            log.warn("Failed to parse cached YF financials list", e);
            return null;
        }
    }
}
