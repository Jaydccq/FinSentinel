package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.news.CryptoNewsApiClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CryptoNewsToolTest {

    @Mock private CryptoNewsApiClient apiClient;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOps;
    @Mock private ObjectMapper objectMapper;

    @InjectMocks private CryptoNewsTool tool;

    private final ObjectMapper testMapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOps);
        lenient().when(valueOps.get(anyString())).thenReturn(null);
    }

    @Test
    void getCryptoNews_filtersAndFormatsResults() throws Exception {
        // The tool reads article.path("title"), article.path("source"), aiRating.path("score"),
        // aiRating.path("grade"), aiRating.path("signal"), aiRating.path("enSummary"),
        // article.path("text"), and article.path("coins").
        String json = """
            {
                "data": [
                    {
                        "id": "1", "title": "BTC News", "text": "<b>BTC detail</b>",
                        "source": "Bloomberg", "coins": [{"symbol": "BTC"}],
                        "aiRating": {"score": 90, "grade": "A", "signal": "long", "enSummary": "Bitcoin surges", "status": "done"}
                    },
                    {
                        "id": "2", "title": "Low score article", "text": "Low score",
                        "source": "Other", "coins": [],
                        "aiRating": {"score": 20, "signal": "neutral", "status": "done"}
                    }
                ]
            }
            """;
        when(apiClient.searchNews(any(), any(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenReturn(testMapper.readTree(json));

        String result = tool.getCryptoNews("bitcoin", "BTC", 70, 5);

        assertThat(result).contains("BTC News");
        assertThat(result).contains("Score: 90");
        assertThat(result).contains("Signal: long");
        assertThat(result).doesNotContain("Low score");
    }

    @Test
    void getCryptoNews_returnsCachedResult() {
        when(valueOps.get(anyString())).thenReturn("cached data");

        String result = tool.getCryptoNews("test", "", 0, 5);

        assertThat(result).isEqualTo("cached data");
        verifyNoInteractions(apiClient);
    }

    @Test
    void getCryptoNews_handlesApiError() {
        when(apiClient.searchNews(any(), any(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenThrow(new RuntimeException("Connection timeout"));

        String result = tool.getCryptoNews("test", "", 0, 5);

        assertThat(result).contains("Error");
    }
}
