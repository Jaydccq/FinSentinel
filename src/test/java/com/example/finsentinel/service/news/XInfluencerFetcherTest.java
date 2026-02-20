package com.example.finsentinel.service.news;

import com.example.finsentinel.config.XProperties;
import com.example.finsentinel.model.enums.NewsSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class XInfluencerFetcherTest {

    @Mock private RestClient restClient;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;

    private XProperties xProperties;
    private XInfluencerFetcher fetcher;
    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        xProperties = new XProperties();
        xProperties.setEnabled(true);
        xProperties.setBearerToken("test-bearer-token");
        xProperties.setBaseUrl("https://api.x.com/2");
        xProperties.setMaxResultsPerUser(10);
        xProperties.setInfluencers(List.of("CathieDWood", "AswathDamodaran"));
        fetcher = new XInfluencerFetcher(xProperties, restClient);
    }

    @Test
    void getSource_returnsXInfluencer() {
        assertThat(fetcher.getSource()).isEqualTo(NewsSource.X_INFLUENCER);
    }

    @Test
    void fetch_resolveUserIdAndFetchTweets() throws Exception {
        // First call: resolve username → user ID
        String userLookupJson = """
                { "data": { "id": "12345", "name": "Cathie Wood", "username": "CathieDWood" } }
                """;

        // Second call: fetch user tweets
        String tweetsJson = """
                {
                  "data": [
                    {
                      "id": "998877",
                      "text": "$TSLA is showing strong momentum in the EV sector. Our models predict continued growth.",
                      "created_at": "2026-02-19T14:30:00Z",
                      "author_id": "12345",
                      "public_metrics": { "like_count": 1500, "retweet_count": 300 },
                      "entities": {
                        "cashtags": [{ "tag": "TSLA" }],
                        "urls": [{ "expanded_url": "https://ark-invest.com/analysis" }]
                      }
                    }
                  ],
                  "meta": { "result_count": 1 }
                }
                """;

        // Mock for second influencer (Damodaran) — resolve
        String userLookup2Json = """
                { "data": { "id": "67890", "name": "Aswath Damodaran", "username": "AswathDamodaran" } }
                """;

        // Damodaran tweets
        String tweets2Json = """
                {
                  "data": [
                    {
                      "id": "112233",
                      "text": "New blog post on valuation frameworks for AI companies. The market is pricing in too much optimism for $NVDA.",
                      "created_at": "2026-02-19T10:00:00Z",
                      "author_id": "67890"
                    }
                  ]
                }
                """;

        // We'll mock the RestClient chain to return different responses sequentially
        JsonNode userLookupNode = objectMapper.readTree(userLookupJson);
        JsonNode tweetsNode = objectMapper.readTree(tweetsJson);
        JsonNode userLookup2Node = objectMapper.readTree(userLookup2Json);
        JsonNode tweets2Node = objectMapper.readTree(tweets2Json);

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.header(anyString(), anyString())).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class))
                .thenReturn(userLookupNode)
                .thenReturn(tweetsNode)
                .thenReturn(userLookup2Node)
                .thenReturn(tweets2Node);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("TSLA", "NVDA"));

        assertThat(results).hasSize(2);

        // First tweet: CathieDWood
        NewsFetcher.RawNewsItem cathieTweet = results.get(0);
        assertThat(cathieTweet.sourceId()).isEqualTo("998877");
        assertThat(cathieTweet.source()).isEqualTo(NewsSource.X_INFLUENCER);
        assertThat(cathieTweet.author()).isEqualTo("@CathieDWood");
        assertThat(cathieTweet.tickers()).contains("TSLA");
        assertThat(cathieTweet.articleUrl()).isEqualTo("https://ark-invest.com/analysis");
        assertThat(cathieTweet.tags()).contains("x-influencer", "CathieDWood");

        // Second tweet: Damodaran
        NewsFetcher.RawNewsItem damodaranTweet = results.get(1);
        assertThat(damodaranTweet.sourceId()).isEqualTo("112233");
        assertThat(damodaranTweet.author()).isEqualTo("@AswathDamodaran");
        assertThat(damodaranTweet.tickers()).contains("NVDA");
    }

    @Test
    void fetch_emptyInfluencerList_returnsEmpty() {
        xProperties.setInfluencers(List.of());
        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));
        assertThat(results).isEmpty();
    }

    @Test
    void fetch_userIdResolutionFails_skipsUser() throws Exception {
        xProperties.setInfluencers(List.of("nonexistent_user"));

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.header(anyString(), anyString())).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenThrow(new RuntimeException("User not found"));

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results).isEmpty();
    }

    @Test
    void fetch_noTweetsData_returnsEmpty() throws Exception {
        xProperties.setInfluencers(List.of("emptyUser"));

        String userJson = """
                { "data": { "id": "99999", "username": "emptyUser" } }
                """;
        String emptyTweetsJson = """
                { "meta": { "result_count": 0 } }
                """;

        JsonNode userNode = objectMapper.readTree(userJson);
        JsonNode emptyNode = objectMapper.readTree(emptyTweetsJson);

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.header(anyString(), anyString())).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class))
                .thenReturn(userNode)
                .thenReturn(emptyNode);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results).isEmpty();
    }

    @Test
    void parseTweet_extractsTickersFromTextRegex() throws Exception {
        String tweetJson = """
                {
                  "id": "555",
                  "text": "Watching $AAPL and $MSFT closely today. Both showing strength.",
                  "created_at": "2026-02-19T09:00:00Z"
                }
                """;

        JsonNode tweet = objectMapper.readTree(tweetJson);
        NewsFetcher.RawNewsItem item = fetcher.parseTweet(tweet, "testuser");

        assertThat(item).isNotNull();
        assertThat(item.tickers()).containsExactly("AAPL", "MSFT");
    }

    @Test
    void parseTweet_buildsTitleFromText() throws Exception {
        String tweetJson = """
                {
                  "id": "666",
                  "text": "This is a very long tweet that should be truncated for the title field because we only want to show a brief preview in the news feed list and not the entire content of the tweet which could be quite lengthy",
                  "created_at": "2026-02-19T09:00:00Z"
                }
                """;

        JsonNode tweet = objectMapper.readTree(tweetJson);
        NewsFetcher.RawNewsItem item = fetcher.parseTweet(tweet, "longwriter");

        assertThat(item).isNotNull();
        assertThat(item.title()).startsWith("@longwriter: ");
        assertThat(item.title().length()).isLessThanOrEqualTo(140); // @user: prefix + 120 chars max
    }

    @Test
    void parseTweet_nullId_returnsNull() throws Exception {
        String tweetJson = """
                { "text": "No id here", "created_at": "2026-02-19T09:00:00Z" }
                """;

        JsonNode tweet = objectMapper.readTree(tweetJson);
        NewsFetcher.RawNewsItem item = fetcher.parseTweet(tweet, "testuser");

        assertThat(item).isNull();
    }

    @Test
    void parseTweet_extractsEntityUrls() throws Exception {
        String tweetJson = """
                {
                  "id": "777",
                  "text": "Great analysis here",
                  "created_at": "2026-02-19T09:00:00Z",
                  "entities": {
                    "urls": [
                      { "expanded_url": "https://seekingalpha.com/article/12345" }
                    ]
                  }
                }
                """;

        JsonNode tweet = objectMapper.readTree(tweetJson);
        NewsFetcher.RawNewsItem item = fetcher.parseTweet(tweet, "analyst");

        assertThat(item).isNotNull();
        assertThat(item.articleUrl()).isEqualTo("https://seekingalpha.com/article/12345");
    }

    @Test
    void parseTweet_noEntityUrls_usesTweetPermalink() throws Exception {
        String tweetJson = """
                {
                  "id": "888",
                  "text": "Just my thoughts on the market today",
                  "created_at": "2026-02-19T09:00:00Z"
                }
                """;

        JsonNode tweet = objectMapper.readTree(tweetJson);
        NewsFetcher.RawNewsItem item = fetcher.parseTweet(tweet, "thinker");

        assertThat(item).isNotNull();
        assertThat(item.articleUrl()).isEqualTo("https://x.com/thinker/status/888");
    }

    @Test
    void resolveUserId_cachesResult() throws Exception {
        String userJson = """
                { "data": { "id": "11111", "username": "cached_user" } }
                """;

        JsonNode userNode = objectMapper.readTree(userJson);

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.header(anyString(), anyString())).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(userNode);

        // Call twice
        String id1 = fetcher.resolveUserId("cached_user");
        String id2 = fetcher.resolveUserId("cached_user");

        assertThat(id1).isEqualTo("11111");
        assertThat(id2).isEqualTo("11111");

        // RestClient should only be called once (cached on second call)
        verify(restClient, times(1)).get();
    }
}
