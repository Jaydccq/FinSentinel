package com.example.finsentinel.service.research;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import com.example.finsentinel.service.ApiKeyService;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Research data provider backed by the Polygon.io API.
 *
 * <p>Implements company profile retrieval via the ticker details endpoint and
 * financial metrics via the experimental financials endpoint. All responses are
 * cached in Redis to reduce API usage and improve latency.
 *
 * <p>This provider is conditionally loaded only when {@code app.polygon.api-key}
 * is configured.
 */
@Component
@ConditionalOnProperty(name = "app.polygon.api-key")
@RequiredArgsConstructor
@Slf4j
public class PolygonResearchProvider implements ResearchDataProvider {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final ObjectProvider<ApiKeyService> apiKeyServiceProvider;

    private static final Duration PROFILE_TTL = Duration.ofHours(24);
    private static final Duration FINANCIALS_TTL = Duration.ofHours(6);
    private static final MathContext MC = new MathContext(15, RoundingMode.HALF_UP);
    private static final int SCALE = 2;

    @Override
    public String getName() {
        return "polygon";
    }

    /**
     * Returns the effective Polygon API key for the current user,
     * falling back to the configured environment property.
     */
    private String apiKey() {
        ApiKeyService apiKeyService = apiKeyServiceProvider.getIfAvailable();
        if (apiKeyService != null) {
            return apiKeyService.getEffectiveKeyForCurrentUser(
                    ApiKeyService.KnownKey.POLYGON_API_KEY.name(),
                    polygonProperties.getApiKey()
            );
        }
        return polygonProperties.getApiKey();
    }

    // ──────────────────────────── Company Profile ────────────────────────────

    @Override
    public CompanyProfile getCompanyProfile(String ticker) {
        ticker = ticker.toUpperCase().trim();
        String cacheKey = "research:profile:" + ticker;

        // Check cache
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            CompanyProfile parsed = parseProfile(cached);
            if (parsed != null) {
                log.debug("Cache hit for company profile: {}", ticker);
                return parsed;
            }
            redisTemplate.delete(cacheKey);
            log.warn("Evicted corrupted profile cache for {}", ticker);
        }

        // Call Polygon API
        try {
            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/v3/reference/tickers/{ticker}?apiKey={apiKey}",
                            ticker, apiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !response.has("results")) {
                log.warn("No profile data returned for {}", ticker);
                return null;
            }

            JsonNode results = response.get("results");
            CompanyProfile profile = new CompanyProfile(
                    ticker,
                    results.path("name").asText("Unknown"),
                    results.path("description").asText("No description available"),
                    results.path("sic_description").asText("Unknown"),
                    extractIndustry(results),
                    results.path("homepage_url").asText(""),
                    toBigDecimal(results.path("market_cap")),
                    results.path("total_employees").asInt(0),
                    results.path("list_date").asText("Unknown"),
                    results.path("primary_exchange").asText("Unknown")
            );

            // Cache result
            cacheJson(cacheKey, objectMapper.writeValueAsString(profile), PROFILE_TTL);
            log.info("Fetched company profile for {}", ticker);
            return profile;

        } catch (Exception e) {
            log.error("Failed to fetch company profile for {}", ticker, e);
            return null;
        }
    }

    // ──────────────────────────── Financial Metrics ──────────────────────────

    @Override
    public List<FinancialMetrics> getFinancialMetrics(String ticker, int periods) {
        ticker = ticker.toUpperCase().trim();
        periods = Math.min(Math.max(periods, 1), 10);
        String cacheKey = "research:financials:" + ticker + ":" + periods;

        // Check cache
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            List<FinancialMetrics> parsed = parseFinancialsList(cached);
            if (parsed != null && !parsed.isEmpty()) {
                log.debug("Cache hit for financials: {}", ticker);
                return parsed;
            }
            redisTemplate.delete(cacheKey);
            log.warn("Evicted corrupted financials cache for {}", ticker);
        }

        // Call Polygon API
        try {
            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/vX/reference/financials?ticker={ticker}&limit={limit}&apiKey={apiKey}",
                            ticker, periods, apiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !response.has("results") || response.get("results").isEmpty()) {
                log.warn("No financial data returned for {}", ticker);
                return List.of();
            }

            List<FinancialMetrics> metricsList = new ArrayList<>();
            BigDecimal previousRevenue = null;

            // Iterate in reverse order to compute YoY growth correctly (oldest first)
            JsonNode results = response.get("results");
            List<JsonNode> filings = new ArrayList<>();
            for (JsonNode node : results) {
                filings.add(node);
            }

            // Process oldest-to-newest for growth calculation
            for (int i = filings.size() - 1; i >= 0; i--) {
                JsonNode filing = filings.get(i);
                FinancialMetrics metrics = parseFilingToMetrics(ticker, filing, previousRevenue);
                if (metrics != null) {
                    metricsList.addFirst(metrics);
                    previousRevenue = metrics.revenue();
                }
            }

            // Cache result
            cacheJson(cacheKey, objectMapper.writeValueAsString(metricsList), FINANCIALS_TTL);
            log.info("Fetched {} financial periods for {}", metricsList.size(), ticker);
            return metricsList;

        } catch (Exception e) {
            log.error("Failed to fetch financials for {}", ticker, e);
            return List.of();
        }
    }

    // ──────────────────────────── Price Helper ───────────────────────────────

    /**
     * Fetches the current closing price for a ticker from Polygon.io previous-close endpoint.
     */
    BigDecimal fetchCurrentPrice(String ticker) {
        String cacheKey = "research:price:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            try {
                return new BigDecimal(cached);
            } catch (NumberFormatException e) {
                redisTemplate.delete(cacheKey);
            }
        }

        try {
            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/v2/aggs/ticker/{ticker}/prev?apiKey={apiKey}",
                            ticker, apiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response != null && response.has("results") && !response.get("results").isEmpty()) {
                double close = response.get("results").get(0).path("c").asDouble(0);
                if (close > 0) {
                    BigDecimal price = BigDecimal.valueOf(close).setScale(SCALE, RoundingMode.HALF_UP);
                    redisTemplate.opsForValue().set(cacheKey, price.toPlainString(),
                            Duration.ofMinutes(15));
                    return price;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to fetch current price for {}: {}", ticker, e.getMessage());
        }
        return null;
    }

    // ──────────────────────────── Private Helpers ────────────────────────────

    /**
     * Parses a single Polygon financials filing result into a {@link FinancialMetrics} record.
     */
    private FinancialMetrics parseFilingToMetrics(String ticker, JsonNode filing,
                                                   BigDecimal previousRevenue) {
        try {
            JsonNode financials = filing.path("financials");
            JsonNode income = financials.path("income_statement");
            JsonNode balance = financials.path("balance_sheet");
            JsonNode cashFlow = financials.path("cash_flow_statement");

            String fiscalPeriod = filing.path("fiscal_period").asText("Unknown");
            String fiscalYear = filing.path("fiscal_year").asText("");
            String period = "FY".equals(fiscalPeriod) ? "annual" : "quarterly";
            String periodLabel = "FY".equals(fiscalPeriod)
                    ? "FY" + fiscalYear
                    : fiscalPeriod + " " + fiscalYear;

            // Income statement
            BigDecimal revenue = extractValue(income, "revenues");
            BigDecimal grossProfit = extractValue(income, "gross_profit");
            BigDecimal operatingIncome = extractValue(income, "operating_income_loss");
            BigDecimal netIncome = extractValue(income, "net_income_loss");
            BigDecimal eps = extractValue(income, "basic_earnings_per_share");

            // Margins
            BigDecimal grossMargin = safeDividePercent(grossProfit, revenue);
            BigDecimal operatingMargin = safeDividePercent(operatingIncome, revenue);
            BigDecimal netMargin = safeDividePercent(netIncome, revenue);

            // Balance sheet
            BigDecimal totalAssets = extractValue(balance, "assets");
            BigDecimal totalLiabilities = extractValue(balance, "liabilities");
            BigDecimal totalEquity = extractValue(balance, "equity");
            BigDecimal currentAssets = extractValue(balance, "current_assets");
            BigDecimal currentLiabilities = extractValue(balance, "current_liabilities");
            BigDecimal totalDebt = extractValue(balance, "long_term_debt");

            BigDecimal currentRatio = safeDivide(currentAssets, currentLiabilities);
            BigDecimal debtToEquity = safeDivide(totalDebt, totalEquity);

            // Valuation (PE and PB require current price)
            BigDecimal peRatio = null;
            BigDecimal pbRatio = null;
            if (eps != null && eps.compareTo(BigDecimal.ZERO) > 0) {
                BigDecimal currentPrice = fetchCurrentPrice(ticker);
                if (currentPrice != null && currentPrice.compareTo(BigDecimal.ZERO) > 0) {
                    peRatio = currentPrice.divide(eps, SCALE, RoundingMode.HALF_UP);

                    // Book value per share = equity / (net income / EPS) ~ equity * EPS / net income
                    if (totalEquity != null && netIncome != null
                            && netIncome.compareTo(BigDecimal.ZERO) != 0) {
                        BigDecimal sharesOutstanding = netIncome.divide(eps, 0, RoundingMode.HALF_UP);
                        if (sharesOutstanding.compareTo(BigDecimal.ZERO) > 0) {
                            BigDecimal bookValuePerShare = totalEquity.divide(
                                    sharesOutstanding, SCALE, RoundingMode.HALF_UP);
                            if (bookValuePerShare.compareTo(BigDecimal.ZERO) > 0) {
                                pbRatio = currentPrice.divide(
                                        bookValuePerShare, SCALE, RoundingMode.HALF_UP);
                            }
                        }
                    }
                }
            }

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
            BigDecimal operatingCashFlow = extractValue(cashFlow,
                    "net_cash_flow_from_operating_activities");
            BigDecimal capex = extractValue(cashFlow,
                    "net_cash_flow_from_investing_activities");
            BigDecimal freeCashFlow = null;
            if (operatingCashFlow != null && capex != null) {
                // Investing activities is typically negative; FCF = operating + investing
                freeCashFlow = operatingCashFlow.add(capex).setScale(SCALE, RoundingMode.HALF_UP);
            }

            return new FinancialMetrics(
                    ticker, period, periodLabel,
                    revenue, netIncome, eps,
                    grossMargin, operatingMargin, netMargin,
                    totalAssets, totalLiabilities, totalEquity,
                    currentRatio, debtToEquity,
                    peRatio, pbRatio, revenueGrowth,
                    operatingCashFlow, freeCashFlow, capex
            );

        } catch (Exception e) {
            log.warn("Failed to parse filing for {}: {}", ticker, e.getMessage());
            return null;
        }
    }

    /**
     * Extracts a financial value from a Polygon financials JSON node.
     * Polygon nests values as: {@code {"field": {"value": 123456}}}.
     */
    private BigDecimal extractValue(JsonNode parent, String field) {
        JsonNode node = parent.path(field);
        if (node.isMissingNode() || !node.has("value")) {
            return null;
        }
        double val = node.get("value").asDouble(0);
        if (val == 0 && !"0".equals(node.get("value").asText())) {
            return null;
        }
        return BigDecimal.valueOf(val).setScale(SCALE, RoundingMode.HALF_UP);
    }

    /**
     * Safely divides numerator by denominator, returning {@code null} if either is null or
     * denominator is zero.
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

    /**
     * Extracts industry from Polygon ticker details.
     * Falls back to SIC description if no explicit industry field.
     */
    private String extractIndustry(JsonNode results) {
        if (results.has("sic_description")) {
            return results.get("sic_description").asText("Unknown");
        }
        return "Unknown";
    }

    /**
     * Converts a JsonNode numeric field to BigDecimal.
     */
    private BigDecimal toBigDecimal(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return BigDecimal.ZERO;
        }
        return BigDecimal.valueOf(node.asDouble(0)).setScale(SCALE, RoundingMode.HALF_UP);
    }

    // ──────────────────────────── Cache Helpers ──────────────────────────────

    private void cacheJson(String key, String json, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(key, json, ttl);
        } catch (Exception e) {
            log.warn("Failed to cache research data for key {}: {}", key, e.getMessage());
        }
    }

    private CompanyProfile parseProfile(String json) {
        try {
            return objectMapper.readValue(json, CompanyProfile.class);
        } catch (JacksonException e) {
            log.warn("Failed to parse cached company profile", e);
            return null;
        }
    }

    private List<FinancialMetrics> parseFinancialsList(String json) {
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(
                            List.class, FinancialMetrics.class));
        } catch (JacksonException e) {
            log.warn("Failed to parse cached financials list", e);
            return null;
        }
    }
}
