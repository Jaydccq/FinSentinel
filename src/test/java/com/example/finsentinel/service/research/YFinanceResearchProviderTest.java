package com.example.finsentinel.service.research;

import com.example.finsentinel.config.YahooFinanceProperties;
import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link YFinanceResearchProvider}.
 *
 * <p>Uses mocked RestClient to verify JSON parsing of Yahoo Finance v10
 * quoteSummary responses without requiring live API access.
 */
@ExtendWith(MockitoExtension.class)
class YFinanceResearchProviderTest {

    @Mock private RestClient restClient;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOps;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private YahooFinanceProperties yahooProperties;
    private YFinanceResearchProvider provider;

    @BeforeEach
    void setUp() {
        yahooProperties = new YahooFinanceProperties();
        yahooProperties.setBaseUrl("https://query1.finance.yahoo.com");
        provider = new YFinanceResearchProvider(
                restClient, yahooProperties, objectMapper, redisTemplate);
    }

    @Test
    void getName_returnsYfinance() {
        assertThat(provider.getName()).isEqualTo("yfinance");
    }

    @Test
    void supports_acceptsAllTickers() {
        assertThat(provider.supports("AAPL")).isTrue();
        assertThat(provider.supports("MSFT")).isTrue();
        assertThat(provider.supports("BTC-USD")).isTrue();
    }

    @Test
    void implementsResearchDataProvider() {
        assertThat(provider).isInstanceOf(ResearchDataProvider.class);
    }

    // ──────────────────────────── Company Profile ────────────────────────────

    @Test
    void getCompanyProfile_parsesYahooResponseCorrectly() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:profile:AAPL")).thenReturn(null);
        mockRestClientResponse(PROFILE_RESPONSE);

        CompanyProfile profile = provider.getCompanyProfile("AAPL");

        assertThat(profile).isNotNull();
        assertThat(profile.ticker()).isEqualTo("AAPL");
        assertThat(profile.name()).isEqualTo("Apple Inc.");
        assertThat(profile.sector()).isEqualTo("Technology");
        assertThat(profile.industry()).isEqualTo("Consumer Electronics");
        assertThat(profile.description()).contains("Apple Inc. designs");
        assertThat(profile.homepageUrl()).isEqualTo("https://www.apple.com");
        assertThat(profile.marketCap()).isEqualByComparingTo(new BigDecimal("3000000000000"));
        assertThat(profile.employeeCount()).isEqualTo(164000);
        assertThat(profile.listDate()).isEqualTo("N/A");
        assertThat(profile.exchange()).isEqualTo("NasdaqGS");
    }

    @Test
    void getCompanyProfile_normalizesTickerToUpperCase() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:profile:AAPL")).thenReturn(null);
        mockRestClientResponse(PROFILE_RESPONSE);

        CompanyProfile profile = provider.getCompanyProfile("aapl");

        assertThat(profile).isNotNull();
        assertThat(profile.ticker()).isEqualTo("AAPL");
    }

    @Test
    void getCompanyProfile_returnsNullOnApiError() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:profile:INVALID")).thenReturn(null);
        mockRestClientResponse(ERROR_RESPONSE);

        CompanyProfile profile = provider.getCompanyProfile("INVALID");

        assertThat(profile).isNull();
    }

    @Test
    void getCompanyProfile_returnsNullOnConnectionFailure() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:profile:AAPL")).thenReturn(null);
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        CompanyProfile profile = provider.getCompanyProfile("AAPL");

        assertThat(profile).isNull();
    }

    @Test
    void getCompanyProfile_returnsCachedValue() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        String cachedJson = """
                {"ticker":"AAPL","name":"Apple Inc.","description":"Cached desc",\
                "sector":"Technology","industry":"Consumer Electronics",\
                "homepageUrl":"https://www.apple.com","marketCap":3000000000000,\
                "employeeCount":164000,"listDate":"N/A","exchange":"NasdaqGS"}""";
        when(valueOps.get("yf:profile:AAPL")).thenReturn(cachedJson);

        CompanyProfile profile = provider.getCompanyProfile("AAPL");

        assertThat(profile).isNotNull();
        assertThat(profile.name()).isEqualTo("Apple Inc.");
        assertThat(profile.description()).isEqualTo("Cached desc");
    }

    // ──────────────────────────── Financial Metrics ──────────────────────────

    @Test
    void getFinancialMetrics_parsesStatementsCorrectly() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:financials:AAPL:4")).thenReturn(null);
        mockRestClientResponse(FINANCIALS_RESPONSE);

        List<FinancialMetrics> metrics = provider.getFinancialMetrics("AAPL", 4);

        assertThat(metrics).hasSize(2);

        // First entry (most recent — FY2023)
        FinancialMetrics fy2023 = metrics.get(0);
        assertThat(fy2023.ticker()).isEqualTo("AAPL");
        assertThat(fy2023.period()).isEqualTo("annual");
        assertThat(fy2023.fiscalPeriod()).isEqualTo("FY2023");
        assertThat(fy2023.revenue()).isEqualByComparingTo(new BigDecimal("394328000000"));
        assertThat(fy2023.netIncome()).isEqualByComparingTo(new BigDecimal("96995000000"));
        assertThat(fy2023.totalAssets()).isEqualByComparingTo(new BigDecimal("352583000000"));
        assertThat(fy2023.totalLiabilities()).isEqualByComparingTo(new BigDecimal("290437000000"));
        assertThat(fy2023.totalEquity()).isEqualByComparingTo(new BigDecimal("62146000000"));
        assertThat(fy2023.operatingCashFlow()).isEqualByComparingTo(new BigDecimal("110543000000"));
        assertThat(fy2023.capitalExpenditure()).isEqualByComparingTo(new BigDecimal("-10959000000"));
        assertThat(fy2023.freeCashFlow()).isNotNull();

        // Revenue growth should be present (computed YoY from FY2022)
        assertThat(fy2023.revenueGrowth()).isNotNull();

        // Second entry (older — FY2022)
        FinancialMetrics fy2022 = metrics.get(1);
        assertThat(fy2022.fiscalPeriod()).isEqualTo("FY2022");
        assertThat(fy2022.revenue()).isEqualByComparingTo(new BigDecimal("365817000000"));
        // First period has no YoY growth (no predecessor)
        assertThat(fy2022.revenueGrowth()).isNull();
    }

    @Test
    void getFinancialMetrics_respectsPeriodLimit() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:financials:AAPL:1")).thenReturn(null);
        mockRestClientResponse(FINANCIALS_RESPONSE);

        List<FinancialMetrics> metrics = provider.getFinancialMetrics("AAPL", 1);

        // Should only return 1 period even though response has 2
        assertThat(metrics).hasSize(1);
        assertThat(metrics.get(0).fiscalPeriod()).isEqualTo("FY2023");
    }

    @Test
    void getFinancialMetrics_returnsEmptyListOnApiError() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:financials:INVALID:4")).thenReturn(null);
        mockRestClientResponse(ERROR_RESPONSE);

        List<FinancialMetrics> metrics = provider.getFinancialMetrics("INVALID", 4);

        assertThat(metrics).isEmpty();
    }

    @Test
    void getFinancialMetrics_returnsEmptyListOnConnectionFailure() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:financials:AAPL:4")).thenReturn(null);
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        List<FinancialMetrics> metrics = provider.getFinancialMetrics("AAPL", 4);

        assertThat(metrics).isEmpty();
    }

    @Test
    void getFinancialMetrics_clampsPeriodsToValidRange() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        // Requesting 100 periods should be clamped to 10
        when(valueOps.get("yf:financials:AAPL:10")).thenReturn(null);
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        List<FinancialMetrics> metrics = provider.getFinancialMetrics("AAPL", 100);

        assertThat(metrics).isEmpty();
    }

    @Test
    void getFinancialMetrics_computesMarginsCorrectly() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("yf:financials:AAPL:4")).thenReturn(null);
        mockRestClientResponse(FINANCIALS_RESPONSE);

        List<FinancialMetrics> metrics = provider.getFinancialMetrics("AAPL", 4);

        FinancialMetrics fy2023 = metrics.get(0);
        // Net margin = netIncome / revenue * 100
        assertThat(fy2023.netMargin()).isNotNull();
        assertThat(fy2023.netMargin().doubleValue()).isCloseTo(24.59, org.assertj.core.data.Offset.offset(1.0));
        // Current ratio = currentAssets / currentLiabilities
        assertThat(fy2023.currentRatio()).isNotNull();
    }

    // ──────────────────────────── Helper ─────────────────────────────────────

    @SuppressWarnings("unchecked")
    private void mockRestClientResponse(String responseBody) {
        RestClient.RequestHeadersUriSpec<?> requestSpec = mock(RestClient.RequestHeadersUriSpec.class);
        RestClient.RequestHeadersSpec<?> headersSpec = mock(RestClient.RequestHeadersSpec.class);
        RestClient.ResponseSpec responseSpec = mock(RestClient.ResponseSpec.class);

        doReturn(requestSpec).when(restClient).get();
        doReturn(headersSpec).when(requestSpec).uri(anyString());
        doReturn(headersSpec).when(headersSpec).header(anyString(), any(String[].class));
        doReturn(responseSpec).when(headersSpec).retrieve();
        doReturn(responseBody).when(responseSpec).body(String.class);
    }

    // ──────────────────────────── Test Data ──────────────────────────────────

    private static final String PROFILE_RESPONSE = """
            {
              "quoteSummary": {
                "result": [{
                  "assetProfile": {
                    "sector": "Technology",
                    "industry": "Consumer Electronics",
                    "longBusinessSummary": "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories.",
                    "fullTimeEmployees": 164000,
                    "website": "https://www.apple.com"
                  },
                  "price": {
                    "marketCap": {"raw": 3000000000000, "fmt": "3T"},
                    "exchangeName": "NasdaqGS",
                    "shortName": "Apple Inc."
                  },
                  "summaryDetail": {
                    "trailingPE": {"raw": 30.5, "fmt": "30.50"},
                    "dividendYield": {"raw": 0.005, "fmt": "0.50%"}
                  }
                }],
                "error": null
              }
            }
            """;

    private static final String FINANCIALS_RESPONSE = """
            {
              "quoteSummary": {
                "result": [{
                  "incomeStatementHistory": {
                    "incomeStatementHistory": [
                      {
                        "endDate": {"raw": 1696032000, "fmt": "2023-09-30"},
                        "totalRevenue": {"raw": 394328000000, "fmt": "394.33B"},
                        "grossProfit": {"raw": 170782000000, "fmt": "170.78B"},
                        "operatingIncome": {"raw": 114301000000, "fmt": "114.30B"},
                        "netIncome": {"raw": 96995000000, "fmt": "97.00B"},
                        "basicEps": {"raw": 6.16, "fmt": "6.16"}
                      },
                      {
                        "endDate": {"raw": 1664496000, "fmt": "2022-09-30"},
                        "totalRevenue": {"raw": 365817000000, "fmt": "365.82B"},
                        "grossProfit": {"raw": 156569000000, "fmt": "156.57B"},
                        "operatingIncome": {"raw": 119437000000, "fmt": "119.44B"},
                        "netIncome": {"raw": 99803000000, "fmt": "99.80B"},
                        "basicEps": {"raw": 6.15, "fmt": "6.15"}
                      }
                    ]
                  },
                  "balanceSheetHistory": {
                    "balanceSheetStatements": [
                      {
                        "endDate": {"raw": 1696032000, "fmt": "2023-09-30"},
                        "totalAssets": {"raw": 352583000000, "fmt": "352.58B"},
                        "totalLiab": {"raw": 290437000000, "fmt": "290.44B"},
                        "totalStockholderEquity": {"raw": 62146000000, "fmt": "62.15B"},
                        "totalCurrentAssets": {"raw": 143566000000, "fmt": "143.57B"},
                        "totalCurrentLiabilities": {"raw": 145308000000, "fmt": "145.31B"}
                      },
                      {
                        "endDate": {"raw": 1664496000, "fmt": "2022-09-30"},
                        "totalAssets": {"raw": 352755000000, "fmt": "352.76B"},
                        "totalLiab": {"raw": 302083000000, "fmt": "302.08B"},
                        "totalStockholderEquity": {"raw": 50672000000, "fmt": "50.67B"},
                        "totalCurrentAssets": {"raw": 135405000000, "fmt": "135.41B"},
                        "totalCurrentLiabilities": {"raw": 153982000000, "fmt": "153.98B"}
                      }
                    ]
                  },
                  "cashflowStatementHistory": {
                    "cashflowStatements": [
                      {
                        "endDate": {"raw": 1696032000, "fmt": "2023-09-30"},
                        "totalCashFromOperatingActivities": {"raw": 110543000000, "fmt": "110.54B"},
                        "capitalExpenditures": {"raw": -10959000000, "fmt": "-10.96B"}
                      },
                      {
                        "endDate": {"raw": 1664496000, "fmt": "2022-09-30"},
                        "totalCashFromOperatingActivities": {"raw": 122151000000, "fmt": "122.15B"},
                        "capitalExpenditures": {"raw": -10708000000, "fmt": "-10.71B"}
                      }
                    ]
                  }
                }],
                "error": null
              }
            }
            """;

    private static final String ERROR_RESPONSE = """
            {
              "quoteSummary": {
                "result": null,
                "error": {
                  "code": "Not Found",
                  "description": "Quote not found for ticker symbol: INVALID"
                }
              }
            }
            """;
}
