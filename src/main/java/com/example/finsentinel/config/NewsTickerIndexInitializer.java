package com.example.finsentinel.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

@Slf4j
@Component
@RequiredArgsConstructor
public class NewsTickerIndexInitializer {

    private static final String INDEX_SQL =
            "CREATE INDEX IF NOT EXISTS idx_news_tickers_gin ON news_items USING GIN (tickers)";

    private final JdbcTemplate jdbcTemplate;
    private final DataSource dataSource;

    @EventListener(ApplicationReadyEvent.class)
    public void ensureTickerIndex() {
        if (!isPostgres()) {
            return;
        }

        try {
            jdbcTemplate.execute(INDEX_SQL);
            log.info("Ensured index idx_news_tickers_gin on news_items(tickers)");
        } catch (Exception e) {
            log.warn("Failed to ensure index idx_news_tickers_gin", e);
        }
    }

    private boolean isPostgres() {
        try (Connection connection = dataSource.getConnection()) {
            String product = connection.getMetaData().getDatabaseProductName();
            return product != null && product.toLowerCase().contains("postgresql");
        } catch (SQLException e) {
            log.warn("Unable to inspect database product for ticker index initialization", e);
            return false;
        }
    }
}
