package com.example.finsentinel.service.news;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.enums.NewsSource;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RssNewsFetcherTest {

    private HttpServer server;
    private String baseUrl;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void fetch_parsesRssAndAtomFeedsWithRome() {
        registerContext("/rss", 200, "application/rss+xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0">
                  <channel>
                    <title>Reuters Economy</title>
                    <item>
                      <title>Economy update for $AAPL</title>
                      <description><![CDATA[Analysts discuss $MSFT growth]]></description>
                      <link>https://example.com/rss/1</link>
                      <guid>rss-guid-1</guid>
                      <author>Reuters Staff</author>
                      <pubDate>Fri, 20 Feb 2026 07:00:00 GMT</pubDate>
                      <category>Economy</category>
                      <category>Markets</category>
                    </item>
                  </channel>
                </rss>
                """);

        registerContext("/atom", 200, "application/atom+xml", """
                <?xml version="1.0" encoding="utf-8"?>
                <feed xmlns="http://www.w3.org/2005/Atom">
                  <title>Yahoo Finance</title>
                  <entry>
                    <title>Tech outlook for $TSLA</title>
                    <id>atom-id-1</id>
                    <link href="https://example.com/atom/1"/>
                    <summary>Coverage also mentions $NVDA</summary>
                    <author><name>Yahoo Reporter</name></author>
                    <published>2026-02-20T06:30:00Z</published>
                    <category term="Tech"/>
                  </entry>
                </feed>
                """);

        NewsProperties properties = new NewsProperties();
        properties.setRssFeeds(List.of(
                feed("Reuters Economy", "/rss", "RSS_CNBC"),
                feed("Yahoo Atom", "/atom", "RSS_YAHOO")
        ));

        RssNewsFetcher fetcher = new RssNewsFetcher(properties);
        List<NewsFetcher.RawNewsItem> items = fetcher.fetch(List.of("AAPL"));

        assertThat(items).hasSize(2);

        NewsFetcher.RawNewsItem rssItem = items.stream()
                .filter(item -> "rss-guid-1".equals(item.sourceId()))
                .findFirst()
                .orElseThrow();
        assertThat(rssItem.source()).isEqualTo(NewsSource.RSS_CNBC);
        assertThat(rssItem.articleUrl()).isEqualTo("https://example.com/rss/1");
        assertThat(rssItem.author()).isEqualTo("Reuters Staff");
        assertThat(rssItem.tickers()).containsExactly("AAPL", "MSFT");
        assertThat(rssItem.tags()).containsExactly("Economy", "Markets");
        assertThat(rssItem.publishedAt()).isEqualTo(Instant.parse("2026-02-20T07:00:00Z"));

        NewsFetcher.RawNewsItem atomItem = items.stream()
                .filter(item -> "atom-id-1".equals(item.sourceId()))
                .findFirst()
                .orElseThrow();
        assertThat(atomItem.source()).isEqualTo(NewsSource.RSS_YAHOO);
        assertThat(atomItem.articleUrl()).isEqualTo("https://example.com/atom/1");
        assertThat(atomItem.author()).isEqualTo("Yahoo Reporter");
        assertThat(atomItem.tickers()).containsExactly("TSLA", "NVDA");
        assertThat(atomItem.tags()).containsExactly("Tech");
        assertThat(atomItem.publishedAt()).isEqualTo(Instant.parse("2026-02-20T06:30:00Z"));
    }

    @Test
    void fetch_fallsBackToLinkAndDefaultSourceWhenGuidOrSourceMissing() {
        registerContext("/fallback", 200, "application/rss+xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0">
                  <channel>
                    <title>Fallback Feed</title>
                    <item>
                      <title>Fallback title</title>
                      <description>No guid and no pubDate</description>
                      <link>https://example.com/fallback</link>
                    </item>
                  </channel>
                </rss>
                """);

        NewsProperties properties = new NewsProperties();
        properties.setRssFeeds(List.of(
                feed("Fallback", "/fallback", "RSS_REUTERS")
        ));

        RssNewsFetcher fetcher = new RssNewsFetcher(properties);
        Instant before = Instant.now();
        List<NewsFetcher.RawNewsItem> items = fetcher.fetch(List.of());
        Instant after = Instant.now();

        assertThat(items).hasSize(1);
        NewsFetcher.RawNewsItem item = items.getFirst();
        assertThat(item.source()).isEqualTo(NewsSource.RSS_CNBC);
        assertThat(item.sourceId()).isEqualTo("https://example.com/fallback");
        assertThat(item.publishedAt()).isAfterOrEqualTo(before);
        assertThat(item.publishedAt()).isBeforeOrEqualTo(after);
    }

    @Test
    void fetch_returnsEmptyWhenFeedStatusIsNot200() {
        registerContext("/error", 503, "text/plain", "Service unavailable");

        NewsProperties properties = new NewsProperties();
        properties.setRssFeeds(List.of(
                feed("Unavailable", "/error", "RSS_CNBC")
        ));

        RssNewsFetcher fetcher = new RssNewsFetcher(properties);
        List<NewsFetcher.RawNewsItem> items = fetcher.fetch(List.of());

        assertThat(items).isEmpty();
    }

    private NewsProperties.RssFeedConfig feed(String name, String path, String source) {
        NewsProperties.RssFeedConfig config = new NewsProperties.RssFeedConfig();
        config.setName(name);
        config.setUrl(baseUrl + path);
        config.setSource(source);
        return config;
    }

    private void registerContext(String path, int status, String contentType, String body) {
        server.createContext(path, exchange -> {
            byte[] responseBytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(status, responseBytes.length);
            try (var os = exchange.getResponseBody()) {
                os.write(responseBytes);
            }
        });
    }
}
