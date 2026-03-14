package com.example.finsentinel.service.research;

import com.example.finsentinel.config.PolygonProperties;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link PolygonResearchProvider}.
 *
 * <p>Focuses on structural verification and error-handling behavior.
 * Full API integration tests require live Polygon.io credentials and
 * are excluded from unit test runs.
 */
@ExtendWith(MockitoExtension.class)
class PolygonResearchProviderTest {

    @Mock private RestClient restClient;
    @Mock private PolygonProperties polygonProperties;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOps;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    private PolygonResearchProvider provider;

    @BeforeEach
    void setUp() {
        provider = new PolygonResearchProvider(restClient, polygonProperties, redisTemplate, objectMapper);
    }

    @Test
    void getName_returnsPolygon() {
        assertThat(provider.getName()).isEqualTo("polygon");
    }

    @Test
    void supports_acceptsAllTickers() {
        assertThat(provider.supports("AAPL")).isTrue();
        assertThat(provider.supports("MSFT")).isTrue();
        assertThat(provider.supports("BTC-USD")).isTrue();
    }

    @Test
    void getCompanyProfile_returnsNullOnCacheMissAndApiFailure() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("research:profile:AAPL")).thenReturn(null);
        // RestClient.get() throws before URI template is evaluated,
        // so polygonProperties stubs are not needed
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        var result = provider.getCompanyProfile("AAPL");

        assertThat(result).isNull();
    }

    @Test
    void getFinancialMetrics_returnsEmptyListOnCacheMissAndApiFailure() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("research:financials:AAPL:4")).thenReturn(null);
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        var result = provider.getFinancialMetrics("AAPL", 4);

        assertThat(result).isEmpty();
    }

    @Test
    void getCompanyProfile_normalizesTickerToUpperCase() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        // Verify it looks up the cache with uppercase ticker
        when(valueOps.get("research:profile:AAPL")).thenReturn(null);
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        // Pass lowercase — should still normalize and return null due to API failure
        var result = provider.getCompanyProfile("aapl");

        assertThat(result).isNull();
    }

    @Test
    void getFinancialMetrics_clampsPeriodsToValidRange() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        // Requesting 100 periods should be clamped to 10
        when(valueOps.get("research:financials:AAPL:10")).thenReturn(null);
        when(restClient.get()).thenThrow(new RuntimeException("Connection refused"));

        var result = provider.getFinancialMetrics("AAPL", 100);

        assertThat(result).isEmpty();
    }

    @Test
    void implementsResearchDataProvider() {
        assertThat(provider).isInstanceOf(ResearchDataProvider.class);
    }
}
