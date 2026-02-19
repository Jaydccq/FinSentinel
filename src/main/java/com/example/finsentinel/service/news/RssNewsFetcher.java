package com.example.finsentinel.service.news;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.enums.NewsSource;
import com.rometools.rome.feed.synd.SyndEntry;
import com.rometools.rome.feed.synd.SyndFeed;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Component
@RequiredArgsConstructor
public class RssNewsFetcher implements NewsFetcher {

    private static final Pattern TICKER_PATTERN = Pattern.compile("\\$([A-Z]{1,5})");
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final NewsProperties newsProperties;

    @Override
    public NewsSource getSource() {
        return NewsSource.RSS_CNBC;
    }

    @Override
    public List<RawNewsItem> fetch(List<String> tickers) {
        List<RawNewsItem> results = new ArrayList<>();

        for (NewsProperties.RssFeedConfig feedConfig : newsProperties.getRssFeeds()) {
            try {
                List<RawNewsItem> items = fetchFeed(feedConfig);
                results.addAll(items);
            } catch (Exception e) {
                log.error("Failed to fetch RSS feed: {}", feedConfig.getName(), e);
            }
        }

        log.info("RSS fetched {} news items from {} feeds", results.size(), newsProperties.getRssFeeds().size());
        return results;
    }

    private List<RawNewsItem> fetchFeed(NewsProperties.RssFeedConfig config) throws Exception {
        NewsSource source = parseSource(config.getSource());

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.getUrl()))
                .timeout(Duration.ofSeconds(15))
                .header("User-Agent", "FinSentinel/1.0")
                .GET()
                .build();

        HttpResponse<java.io.InputStream> response = HTTP_CLIENT.send(request,
                HttpResponse.BodyHandlers.ofInputStream());

        if (response.statusCode() != 200) {
            log.warn("RSS feed {} returned status {}", config.getName(), response.statusCode());
            return List.of();
        }

        SyndFeedInput input = new SyndFeedInput();
        SyndFeed feed;
        try (var xmlReader = new XmlReader(response.body())) {
            feed = input.build(xmlReader);
        }

        List<RawNewsItem> items = new ArrayList<>();
        for (SyndEntry entry : feed.getEntries()) {
            RawNewsItem item = parseEntry(entry, source);
            if (item != null) {
                items.add(item);
            }
        }

        return items;
    }

    private RawNewsItem parseEntry(SyndEntry entry, NewsSource source) {
        try {
            String guid = entry.getUri();
            if (guid == null || guid.isBlank()) {
                guid = entry.getLink();
            }
            if (guid == null || guid.isBlank()) {
                return null;
            }

            String title = entry.getTitle() != null ? entry.getTitle() : "Untitled";
            String summary = entry.getDescription() != null ? entry.getDescription().getValue() : "";
            String link = entry.getLink();
            String author = entry.getAuthor();

            Date published = entry.getPublishedDate();
            Instant publishedAt = published != null ? published.toInstant() : Instant.now();

            List<String> tickers = extractTickers(title + " " + summary);
            List<String> tags = extractTags(entry);

            return new RawNewsItem(
                    guid,
                    source,
                    title,
                    summary,
                    link,
                    author,
                    publishedAt,
                    tickers,
                    tags
            );
        } catch (Exception e) {
            log.warn("Failed to parse RSS entry", e);
            return null;
        }
    }

    private List<String> extractTickers(String text) {
        List<String> tickers = new ArrayList<>();
        Matcher matcher = TICKER_PATTERN.matcher(text);
        while (matcher.find()) {
            String ticker = matcher.group(1);
            if (!tickers.contains(ticker)) {
                tickers.add(ticker);
            }
        }
        return tickers;
    }

    private List<String> extractTags(SyndEntry entry) {
        List<String> tags = new ArrayList<>();
        if (entry.getCategories() != null) {
            entry.getCategories().forEach(cat -> {
                if (cat.getName() != null) {
                    tags.add(cat.getName());
                }
            });
        }
        return tags;
    }

    private NewsSource parseSource(String sourceStr) {
        if (sourceStr == null) {
            return NewsSource.RSS_CNBC;
        }
        try {
            return NewsSource.valueOf(sourceStr);
        } catch (IllegalArgumentException e) {
            return NewsSource.RSS_CNBC;
        }
    }
}
