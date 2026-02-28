package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.TwitterProperties;
import com.example.finsentinel.service.twitter.TwitterDataService;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Provides AI agent tools for Twitter/X social intelligence via the 6551 API.
 *
 * <p>Gated by {@code app.twitter-6551.enabled=true}.
 */
@Component
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.twitter-6551.enabled", havingValue = "true")
public class TwitterTool {

    private final TwitterDataService twitterDataService;
    private final TwitterProperties twitterProperties;
    private final StringRedisTemplate redisTemplate;

    @Tool(description = "Get a Twitter/X user profile including follower count, bio, verification status, "
            + "and account metrics. Use this to assess the credibility and influence of a financial commentator "
            + "or company account before analyzing their tweets.")
    public String getTwitterProfile(
            @ToolParam(description = "Twitter username, e.g. 'elonmusk' (with or without @ prefix)") String username) {

        username = sanitizeUsername(username);

        String cacheKey = "twitter:profile:" + username;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        try {
            JsonNode response = twitterDataService.getUserInfo(username);
            JsonNode data = extractData(response);

            if (data == null || data.isEmpty()) {
                return "No Twitter profile found for @" + username;
            }

            JsonNode user = data.isArray() ? data.get(0) : data;

            StringBuilder sb = new StringBuilder();
            sb.append("=== Twitter Profile: @").append(username).append(" ===\n\n");
            sb.append("**Name:** ").append(user.path("name").asText("N/A")).append("\n");
            sb.append("**Username:** @").append(user.path("username").asText(username)).append("\n");
            sb.append("**Bio:** ").append(user.path("description").asText("No bio")).append("\n");
            sb.append("**Verified:** ").append(user.path("verified").asBoolean(false) ? "Yes" : "No").append("\n");
            sb.append("**Followers:** ").append(formatNumber(user.path("followers_count").asLong(
                    user.path("followersCount").asLong(0)))).append("\n");
            sb.append("**Following:** ").append(formatNumber(user.path("following_count").asLong(
                    user.path("followingCount").asLong(0)))).append("\n");
            sb.append("**Tweets:** ").append(formatNumber(user.path("tweet_count").asLong(
                    user.path("tweetCount").asLong(0)))).append("\n");
            sb.append("**Listed:** ").append(formatNumber(user.path("listed_count").asLong(
                    user.path("listedCount").asLong(0)))).append("\n");

            String location = user.path("location").asText("");
            if (!location.isBlank()) {
                sb.append("**Location:** ").append(location).append("\n");
            }

            String createdAt = user.path("created_at").asText(user.path("createdAt").asText(""));
            if (!createdAt.isBlank()) {
                sb.append("**Joined:** ").append(createdAt).append("\n");
            }

            String result = sb.toString();
            redisTemplate.opsForValue().set(cacheKey, result,
                    Duration.ofMinutes(twitterProperties.getCacheTtlMinutes()));
            return result;

        } catch (Exception e) {
            log.error("Failed to fetch Twitter profile for @{}", username, e);
            return "Error fetching Twitter profile for @" + username + ": " + e.getMessage();
        }
    }

    @Tool(description = "Search Twitter/X for tweets matching keywords, a specific user, hashtag, or minimum likes. "
            + "Returns tweet text, engagement metrics, and author info. "
            + "Use this to gauge social sentiment around a stock, crypto, or financial event.")
    public String searchTweets(
            @ToolParam(description = "Search keywords, e.g. '$AAPL earnings' or 'bitcoin ETF'") String keywords,
            @ToolParam(description = "Filter by author username (without @), or null for all users") String fromUser,
            @ToolParam(description = "Filter by hashtag (without #), or null for any") String hashtag,
            @ToolParam(description = "Minimum number of likes to filter low-engagement tweets (0 for no filter)") int minLikes,
            @ToolParam(description = "Number of tweets to return (1-20)") int limit) {

        limit = clampLimit(limit);
        if (fromUser != null && !fromUser.isBlank()) fromUser = sanitizeUsername(fromUser);
        if (keywords != null) keywords = keywords.trim();
        if (hashtag != null) hashtag = hashtag.trim().replaceFirst("^#", "");
        minLikes = Math.max(minLikes, 0);

        try {
            JsonNode response = twitterDataService.searchTweets(keywords, fromUser, hashtag, minLikes, limit);
            JsonNode data = extractData(response);

            if (data == null || data.isEmpty()) {
                return "No tweets found for the given search criteria.";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("=== Twitter Search Results ===\n");
            if (keywords != null && !keywords.isBlank()) sb.append("Keywords: ").append(keywords).append("\n");
            if (fromUser != null && !fromUser.isBlank()) sb.append("From: @").append(fromUser).append("\n");
            if (hashtag != null && !hashtag.isBlank()) sb.append("Hashtag: #").append(hashtag).append("\n");
            sb.append("\n");

            int count = 0;
            for (JsonNode tweet : data) {
                if (count >= limit) break;
                count++;
                appendTweet(sb, tweet, count);
            }

            if (count == 0) {
                return "No tweets matched the search criteria.";
            }

            return sb.toString();

        } catch (Exception e) {
            log.error("Failed to search tweets for keywords={}, fromUser={}", keywords, fromUser, e);
            return "Error searching tweets: " + e.getMessage();
        }
    }

    @Tool(description = "Get recent tweets from a specific Twitter/X user. "
            + "Returns their latest posts with engagement metrics. "
            + "Use this to monitor what a financial influencer, analyst, or company is saying.")
    public String getUserTweets(
            @ToolParam(description = "Twitter username, e.g. 'jimcramer' (with or without @ prefix)") String username,
            @ToolParam(description = "Number of tweets to return (1-20)") int limit) {

        username = sanitizeUsername(username);
        limit = clampLimit(limit);

        try {
            JsonNode response = twitterDataService.getUserTweets(username, limit, false, false);
            JsonNode data = extractData(response);

            if (data == null || data.isEmpty()) {
                return "No recent tweets found for @" + username;
            }

            StringBuilder sb = new StringBuilder();
            sb.append("=== Recent Tweets from @").append(username).append(" ===\n\n");

            int count = 0;
            for (JsonNode tweet : data) {
                if (count >= limit) break;
                count++;
                appendTweet(sb, tweet, count);
            }

            if (count == 0) {
                return "No recent tweets found for @" + username;
            }

            return sb.toString();

        } catch (Exception e) {
            log.error("Failed to fetch tweets for @{}", username, e);
            return "Error fetching tweets for @" + username + ": " + e.getMessage();
        }
    }

    @Tool(description = "Get KOL (Key Opinion Leader) followers for a Twitter/X user. "
            + "Shows which notable/verified accounts follow this user. "
            + "Use this to assess the social credibility and network of a financial influencer.")
    public String getKolFollowers(
            @ToolParam(description = "Twitter username, e.g. 'CathieDWood' (with or without @ prefix)") String username) {

        username = sanitizeUsername(username);

        try {
            JsonNode response = twitterDataService.getKolFollowers(username);
            JsonNode data = extractData(response);

            if (data == null || data.isEmpty()) {
                return "No KOL follower data found for @" + username;
            }

            StringBuilder sb = new StringBuilder();
            sb.append("=== KOL Followers of @").append(username).append(" ===\n\n");

            if (data.isArray()) {
                int count = 0;
                for (JsonNode kol : data) {
                    count++;
                    sb.append(count).append(". **@")
                            .append(kol.path("username").asText(kol.path("screen_name").asText("unknown")))
                            .append("**");
                    String name = kol.path("name").asText("");
                    if (!name.isBlank()) sb.append(" (").append(name).append(")");
                    sb.append("\n");

                    long followers = kol.path("followers_count").asLong(
                            kol.path("followersCount").asLong(0));
                    if (followers > 0) {
                        sb.append("   Followers: ").append(formatNumber(followers)).append("\n");
                    }

                    String bio = kol.path("description").asText(kol.path("bio").asText(""));
                    if (!bio.isBlank()) {
                        String snippet = bio.length() > 150 ? bio.substring(0, 150) + "..." : bio;
                        sb.append("   Bio: ").append(snippet).append("\n");
                    }

                    sb.append("\n");
                }
                sb.append("Total KOL followers: ").append(count).append("\n");
            } else {
                sb.append(data.toPrettyString()).append("\n");
            }

            return sb.toString();

        } catch (Exception e) {
            log.error("Failed to fetch KOL followers for @{}", username, e);
            return "Error fetching KOL followers for @" + username + ": " + e.getMessage();
        }
    }

    // ---- helpers ----

    private void appendTweet(StringBuilder sb, JsonNode tweet, int index) {
        String text = tweet.path("text").asText(tweet.path("full_text").asText(""));
        String author = tweet.path("author").asText(
                tweet.path("user").path("username").asText(
                        tweet.path("username").asText("")));
        String createdAt = tweet.path("created_at").asText(tweet.path("createdAt").asText(""));

        sb.append(index).append(". ");
        if (!author.isBlank()) sb.append("**@").append(author).append("**: ");
        sb.append(text).append("\n");

        long likes = tweet.path("like_count").asLong(tweet.path("likeCount").asLong(0));
        long retweets = tweet.path("retweet_count").asLong(tweet.path("retweetCount").asLong(0));
        long replies = tweet.path("reply_count").asLong(tweet.path("replyCount").asLong(0));

        sb.append("   \u2764\uFE0F ").append(formatNumber(likes))
                .append(" | \uD83D\uDD01 ").append(formatNumber(retweets))
                .append(" | \uD83D\uDCAC ").append(formatNumber(replies));

        if (!createdAt.isBlank()) sb.append(" | ").append(createdAt);
        sb.append("\n\n");
    }

    private static JsonNode extractData(JsonNode response) {
        if (response == null) return null;
        return response.has("data") ? response.get("data") : response;
    }

    private static String sanitizeUsername(String username) {
        if (username == null || username.isBlank()) return "";
        return username.trim().replaceFirst("^@", "");
    }

    private static int clampLimit(int limit) {
        return Math.min(Math.max(limit, 1), 20);
    }

    private static String formatNumber(long value) {
        if (value >= 1_000_000) {
            return String.format("%.1fM", value / 1_000_000.0);
        } else if (value >= 1_000) {
            return String.format("%.1fK", value / 1_000.0);
        }
        return String.valueOf(value);
    }
}
