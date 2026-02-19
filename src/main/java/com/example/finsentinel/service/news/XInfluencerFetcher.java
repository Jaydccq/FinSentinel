package com.example.finsentinel.service.news;

import com.example.finsentinel.config.XProperties;
import com.example.finsentinel.model.enums.NewsSource;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Component
@ConditionalOnProperty(name = "app.x.enabled", havingValue = "true")
public class XInfluencerFetcher implements NewsFetcher {

    private final XProperties xProperties;
    private final RestClient restClient;

    /** Cache username → X user ID to avoid repeated lookups. */
    private final Map<String, String> userIdCache = new ConcurrentHashMap<>();

    private static final Pattern TICKER_PATTERN = Pattern.compile("\\$([A-Z]{1,5})\\b");

    public XInfluencerFetcher(XProperties xProperties, RestClient restClient) {
        this.xProperties = xProperties;
        this.restClient = restClient;
    }

    @Override
    public NewsSource getSource() {
        return NewsSource.X_INFLUENCER;
    }

    @Override
    public List<RawNewsItem> fetch(List<String> tickers) {
        List<RawNewsItem> results = new ArrayList<>();
        List<String> usernames = xProperties.getInfluencers();

        if (usernames == null || usernames.isEmpty()) {
            log.debug("No X influencer usernames configured");
            return results;
        }

        for (String username : usernames) {
            try {
                String userId = resolveUserId(username);
                if (userId == null) {
                    continue;
                }

                List<RawNewsItem> tweets = fetchUserTweets(userId, username);
                results.addAll(tweets);
            } catch (Exception e) {
                log.error("Failed to fetch tweets for @{}", username, e);
            }
        }

        log.info("X influencer fetcher collected {} tweets from {} accounts",
                results.size(), usernames.size());
        return results;
    }

    /**
     * Resolve an X username to a user ID. Results are cached in-memory
     * to minimize API calls (user IDs never change).
     */
    String resolveUserId(String username) {
        return userIdCache.computeIfAbsent(username, u -> {
            try {
                JsonNode response = restClient.get()
                        .uri(xProperties.getBaseUrl() + "/users/by/username/{username}",
                                u)
                        .header("Authorization", "Bearer " + xProperties.getBearerToken())
                        .retrieve()
                        .body(JsonNode.class);

                if (response != null && response.has("data")) {
                    String id = response.get("data").get("id").asText();
                    log.debug("Resolved @{} → user ID {}", u, id);
                    return id;
                }

                log.warn("Could not resolve X user ID for @{}: no data in response", u);
                return null;
            } catch (Exception e) {
                log.error("Failed to resolve X user ID for @{}", u, e);
                return null;
            }
        });
    }

    /**
     * Fetch recent tweets from a user by their numeric user ID.
     */
    private List<RawNewsItem> fetchUserTweets(String userId, String username) {
        List<RawNewsItem> items = new ArrayList<>();

        try {
            JsonNode response = restClient.get()
                    .uri(xProperties.getBaseUrl()
                                    + "/users/{userId}/tweets"
                                    + "?max_results={maxResults}"
                                    + "&exclude=retweets,replies"
                                    + "&tweet.fields=created_at,public_metrics,entities,author_id",
                            userId, xProperties.getMaxResultsPerUser())
                    .header("Authorization", "Bearer " + xProperties.getBearerToken())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !response.has("data")) {
                return items;
            }

            for (JsonNode tweet : response.get("data")) {
                RawNewsItem item = parseTweet(tweet, username);
                if (item != null) {
                    items.add(item);
                }
            }
        } catch (Exception e) {
            log.error("Failed to fetch tweets for user ID {} (@{})", userId, username, e);
        }

        return items;
    }

    /**
     * Parse a single tweet JSON node into a RawNewsItem.
     */
    RawNewsItem parseTweet(JsonNode tweet, String username) {
        try {
            String tweetId = tweet.has("id") ? tweet.get("id").asText() : null;
            if (tweetId == null || tweetId.isBlank()) {
                return null;
            }

            String text = tweet.has("text") ? tweet.get("text").asText() : "";
            String createdAt = tweet.has("created_at") ? tweet.get("created_at").asText() : null;

            Instant publishedAt = createdAt != null
                    ? OffsetDateTime.parse(createdAt, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()
                    : Instant.now();

            // Build a short title from the first line of the tweet (up to 120 chars)
            String title = buildTitle(text, username);

            // Extract $TICKER cashtags from tweet text
            List<String> tickers = extractTickers(tweet, text);

            // Extract the first URL from entities if available (for enrichment)
            String articleUrl = extractUrl(tweet);

            // Build the tweet permalink
            String tweetUrl = "https://x.com/" + username + "/status/" + tweetId;

            return new RawNewsItem(
                    tweetId,
                    NewsSource.X_INFLUENCER,
                    title,
                    text,
                    articleUrl != null ? articleUrl : tweetUrl,
                    "@" + username,
                    publishedAt,
                    tickers,
                    List.of("x-influencer", username)
            );
        } catch (Exception e) {
            log.warn("Failed to parse tweet from @{}", username, e);
            return null;
        }
    }

    private String buildTitle(String text, String username) {
        String firstLine = text.split("\n")[0];
        if (firstLine.length() > 120) {
            firstLine = firstLine.substring(0, 117) + "...";
        }
        return "@" + username + ": " + firstLine;
    }

    /**
     * Extract tickers from both the entities.cashtags array and $TICKER regex in text.
     */
    private List<String> extractTickers(JsonNode tweet, String text) {
        List<String> tickers = new ArrayList<>();

        // From entities.cashtags (structured)
        if (tweet.has("entities")) {
            JsonNode entities = tweet.get("entities");
            if (entities.has("cashtags")) {
                for (JsonNode cashtag : entities.get("cashtags")) {
                    if (cashtag.has("tag")) {
                        String tag = cashtag.get("tag").asText().toUpperCase();
                        if (!tickers.contains(tag)) {
                            tickers.add(tag);
                        }
                    }
                }
            }
        }

        // Fallback: regex extraction from text
        Matcher matcher = TICKER_PATTERN.matcher(text);
        while (matcher.find()) {
            String ticker = matcher.group(1);
            if (!tickers.contains(ticker)) {
                tickers.add(ticker);
            }
        }

        return tickers;
    }

    /**
     * Extract the first expanded URL from tweet entities (for Firecrawl enrichment).
     */
    private String extractUrl(JsonNode tweet) {
        if (tweet.has("entities")) {
            JsonNode entities = tweet.get("entities");
            if (entities.has("urls") && entities.get("urls").isArray()
                    && !entities.get("urls").isEmpty()) {
                JsonNode firstUrl = entities.get("urls").get(0);
                if (firstUrl.has("expanded_url")) {
                    return firstUrl.get("expanded_url").asText();
                }
                if (firstUrl.has("url")) {
                    return firstUrl.get("url").asText();
                }
            }
        }
        return null;
    }
}
