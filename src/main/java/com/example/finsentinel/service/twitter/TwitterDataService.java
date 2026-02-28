package com.example.finsentinel.service.twitter;

import com.example.finsentinel.config.TwitterProperties;
import tools.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * REST client for the 6551 Twitter API.
 *
 * <p>All endpoints are POST with JSON body. Gated by {@code app.twitter-6551.enabled=true}.
 */
@Slf4j
@Service
@ConditionalOnProperty(name = "app.twitter-6551.enabled", havingValue = "true")
public class TwitterDataService {

    private final RestClient restClient;
    private final TwitterProperties properties;

    public TwitterDataService(RestClient.Builder restClientBuilder, TwitterProperties properties) {
        this.properties = properties;
        this.restClient = restClientBuilder
                .baseUrl(properties.getBaseUrl())
                .defaultHeader("Authorization", "Bearer " + properties.getApiToken())
                .build();
    }

    public JsonNode getUserInfo(String username) {
        return post("/open/twitter_user", Map.of("username", username));
    }

    public JsonNode getUserById(String userId) {
        return post("/open/twitter_user_by_id", Map.of("userId", userId));
    }

    public JsonNode getUserTweets(String username, int maxResults,
                                   boolean includeReplies, boolean includeRetweets) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("maxResults", Math.min(maxResults, properties.getMaxResults()));
        body.put("includeReplies", includeReplies);
        body.put("includeRetweets", includeRetweets);
        return post("/open/twitter_user_tweets", body);
    }

    public JsonNode searchTweets(String keywords, String fromUser, String hashtag,
                                  int minLikes, int maxResults) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (keywords != null && !keywords.isBlank()) body.put("keywords", keywords);
        if (fromUser != null && !fromUser.isBlank()) body.put("fromUser", fromUser);
        if (hashtag != null && !hashtag.isBlank()) body.put("hashtag", hashtag);
        if (minLikes > 0) body.put("minLikes", minLikes);
        body.put("maxResults", Math.min(maxResults, properties.getMaxResults()));
        return post("/open/twitter_search", body);
    }

    public JsonNode getFollowerEvents(String username, boolean isFollow, int maxResults) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("isFollow", isFollow);
        body.put("maxResults", Math.min(maxResults, properties.getMaxResults()));
        return post("/open/twitter_follower_events", body);
    }

    public JsonNode getDeletedTweets(String username, int maxResults) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("maxResults", Math.min(maxResults, properties.getMaxResults()));
        return post("/open/twitter_deleted_tweets", body);
    }

    public JsonNode getKolFollowers(String username) {
        return post("/open/twitter_kol_followers", Map.of("username", username));
    }

    private JsonNode post(String path, Map<String, Object> body) {
        return restClient.post()
                .uri(path)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(JsonNode.class);
    }
}
