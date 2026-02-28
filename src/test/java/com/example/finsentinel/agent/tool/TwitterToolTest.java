package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.TwitterProperties;
import com.example.finsentinel.service.twitter.TwitterDataService;
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
class TwitterToolTest {

    @Mock private TwitterDataService twitterDataService;
    @Mock private TwitterProperties twitterProperties;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOps;

    @InjectMocks private TwitterTool tool;

    private final ObjectMapper mapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOps);
        lenient().when(valueOps.get(anyString())).thenReturn(null);
        lenient().when(twitterProperties.getCacheTtlMinutes()).thenReturn(10);
    }

    @Test
    void getTwitterProfile_formatsOutput() throws Exception {
        // The tool calls extractData(response) which returns response.get("data").
        // Since data is an object (not array), it uses data directly as 'user'.
        // It reads: user.path("name"), user.path("verified"),
        //   user.path("followers_count") fallback user.path("followersCount"),
        //   user.path("following_count") fallback user.path("followingCount"),
        //   user.path("tweet_count") fallback user.path("tweetCount"),
        //   user.path("description")
        String json = """
            {
                "data": {
                    "screenName": "elonmusk",
                    "name": "Elon Musk",
                    "description": "CEO of Tesla",
                    "followersCount": 170000000,
                    "followingCount": 500,
                    "tweetCount": 30000,
                    "verified": true
                }
            }
            """;
        when(twitterDataService.getUserInfo("elonmusk")).thenReturn(mapper.readTree(json));

        String result = tool.getTwitterProfile("@elonmusk");

        assertThat(result).contains("@elonmusk");
        assertThat(result).contains("Elon Musk");
        assertThat(result).contains("170.0M");
        assertThat(result).contains("**Verified:** Yes");
    }

    @Test
    void getTwitterProfile_stripsAtPrefix() throws Exception {
        String json = """
            {"data": {"screenName": "test", "name": "Test", "followersCount": 100}}
            """;
        when(twitterDataService.getUserInfo("test")).thenReturn(mapper.readTree(json));

        tool.getTwitterProfile("@test");

        verify(twitterDataService).getUserInfo("test");
    }

    @Test
    void getTwitterProfile_handlesError() {
        when(twitterDataService.getUserInfo(anyString())).thenThrow(new RuntimeException("fail"));

        String result = tool.getTwitterProfile("test");

        assertThat(result).contains("Error");
    }

    @Test
    void searchTweets_formatsResults() throws Exception {
        // The appendTweet helper reads:
        //   tweet.path("text") fallback tweet.path("full_text")
        //   tweet.path("author") fallback tweet.path("user").path("username") fallback tweet.path("username")
        //   tweet.path("like_count") fallback tweet.path("likeCount")
        //   tweet.path("retweet_count") fallback tweet.path("retweetCount")
        //   tweet.path("reply_count") fallback tweet.path("replyCount")
        String json = """
            {
                "data": [
                    {
                        "text": "Bitcoin to the moon",
                        "username": "crypto_fan",
                        "like_count": 5000,
                        "retweet_count": 1000,
                        "reply_count": 200,
                        "created_at": "2026-02-27T12:00:00Z"
                    }
                ]
            }
            """;
        when(twitterDataService.searchTweets(any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(mapper.readTree(json));

        String result = tool.searchTweets("Bitcoin", "", "", 0, 5);

        assertThat(result).contains("Bitcoin to the moon");
        assertThat(result).contains("@crypto_fan");
        assertThat(result).contains("5.0K");
    }
}
