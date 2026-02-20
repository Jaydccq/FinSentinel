package com.example.finsentinel.service.news;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.model.enums.NewsSource;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class PolygonNewsFetcher implements NewsFetcher {

    private final PolygonProperties polygonProperties;
    private final RestClient restClient;

    @Override
    public NewsSource getSource() {
        return NewsSource.POLYGON;
    }

    @Override
    public List<RawNewsItem> fetch(List<String> tickers) {
        List<RawNewsItem> results = new ArrayList<>();
        String publishedAfter = LocalDate.now().minusDays(7)
                .format(DateTimeFormatter.ISO_LOCAL_DATE);

        for (String ticker : tickers) {
            try {
                JsonNode response = restClient.get()
                        .uri(polygonProperties.getBaseUrl() +
                                        "/v2/reference/news?ticker={ticker}&published_utc.gte={date}&limit=50&apiKey={apiKey}",
                                ticker, publishedAfter, polygonProperties.getApiKey())
                        .retrieve()
                        .body(JsonNode.class);

                if (response != null && response.has("results")) {
                    for (JsonNode article : response.get("results")) {
                        RawNewsItem item = parseArticle(article, ticker);
                        if (item != null) {
                            results.add(item);
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Failed to fetch Polygon news for {}", ticker, e);
            }
        }

        log.info("Polygon fetched {} news items for {} tickers", results.size(), tickers.size());
        return results;
    }

    private RawNewsItem parseArticle(JsonNode article, String ticker) {
        try {
            String id = article.has("id") ? article.get("id").asText() : null;
            if (id == null || id.isBlank()) {
                return null;
            }

            String title = article.has("title") ? article.get("title").asText() : "Untitled";
            String description = article.has("description") ? article.get("description").asText() : "";
            String author = article.has("author") ? article.get("author").asText() : null;
            String articleUrl = article.has("article_url") ? article.get("article_url").asText() : "";
            String publishedUtc = article.has("published_utc") ? article.get("published_utc").asText() : null;

            Instant publishedAt = publishedUtc != null ? Instant.parse(publishedUtc) : Instant.now();

            List<String> relatedTickers = new ArrayList<>();
            relatedTickers.add(ticker);
            if (article.has("tickers")) {
                for (JsonNode t : article.get("tickers")) {
                    String tickerVal = t.asText();
                    if (!relatedTickers.contains(tickerVal)) {
                        relatedTickers.add(tickerVal);
                    }
                }
            }

            List<String> tags = new ArrayList<>();
            if (article.has("keywords")) {
                for (JsonNode kw : article.get("keywords")) {
                    tags.add(kw.asText());
                }
            }

            return new RawNewsItem(
                    id,
                    NewsSource.POLYGON,
                    title,
                    description,
                    articleUrl,
                    author,
                    publishedAt,
                    relatedTickers,
                    tags
            );
        } catch (Exception e) {
            log.warn("Failed to parse Polygon article", e);
            return null;
        }
    }
}
