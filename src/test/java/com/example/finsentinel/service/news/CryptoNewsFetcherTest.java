package com.example.finsentinel.service.news;

import com.example.finsentinel.config.CryptoNewsProperties;
import com.example.finsentinel.model.enums.NewsSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CryptoNewsFetcherTest {

    @Mock
    private CryptoNewsApiClient apiClient;

    @Mock
    private CryptoNewsProperties properties;

    @InjectMocks
    private CryptoNewsFetcher fetcher;

    private final ObjectMapper mapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        lenient().when(properties.getWatchCoins()).thenReturn(List.of("BTC", "ETH"));
        lenient().when(properties.getMaxResultsPerFetch()).thenReturn(30);
        lenient().when(properties.getMinAiScore()).thenReturn(70);
    }

    @Test
    void getSource_returnsCrypto6551() {
        assertThat(fetcher.getSource()).isEqualTo(NewsSource.CRYPTO_6551);
    }

    @Test
    void fetch_filtersLowScoreArticles() throws Exception {
        String json = """
            {
                "data": [
                    {
                        "id": "art1",
                        "text": "Bitcoin hits new high",
                        "newsType": "Cointelegraph",
                        "link": "https://example.com/1",
                        "coins": [{"symbol": "BTC"}],
                        "aiRating": {"score": 85, "grade": "A", "signal": "long", "status": "done", "enSummary": "BTC surges", "summary": "BTC\u4e0a\u6da8"},
                        "ts": 1708473600000
                    },
                    {
                        "id": "art2",
                        "text": "Minor altcoin update",
                        "newsType": "Twitter",
                        "link": "",
                        "coins": [],
                        "aiRating": {"score": 30, "grade": "C", "signal": "neutral", "status": "done"},
                        "ts": 1708473600000
                    }
                ]
            }
            """;
        JsonNode response = mapper.readTree(json);
        when(apiClient.searchNews(any(), any(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenReturn(response);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("BTC"));

        assertThat(results).hasSize(1);
        assertThat(results.getFirst().sourceId()).isEqualTo("art1");
        assertThat(results.getFirst().title()).isEqualTo("BTC surges");
        assertThat(results.getFirst().tickers()).containsExactly("BTC");
        assertThat(results.getFirst().source()).isEqualTo(NewsSource.CRYPTO_6551);
    }

    @Test
    void fetch_returnsEmptyOnApiError() {
        when(apiClient.searchNews(any(), any(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenThrow(new RuntimeException("API error"));

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("BTC"));

        assertThat(results).isEmpty();
    }

    @Test
    void fetch_returnsEmptyOnNullResponse() {
        when(apiClient.searchNews(any(), any(), any(), anyBoolean(), anyInt(), anyInt()))
                .thenReturn(null);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("BTC"));

        assertThat(results).isEmpty();
    }
}
