package com.example.finsentinel.service.okx;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory cache of real-time OKX ticker snapshots fed by {@link OkxWebSocketClient}.
 *
 * <p>Maintains a {@link ConcurrentHashMap} keyed by instrument ID (e.g. "BTC-USDT").
 * Each entry holds the latest bid/ask/last/volume from the WebSocket ticker channel.
 *
 * <p>Thread-safe: multiple WebSocket listener threads can call {@link #updateTicker}
 * concurrently while controller threads read via {@link #getPrice} or {@link #getSnapshot}.
 */
@Service
@Slf4j
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class OkxPriceService {

    /**
     * Immutable snapshot of a single instrument's ticker data.
     *
     * @param instId     instrument ID (e.g. "BTC-USDT")
     * @param last       last traded price
     * @param bid        best bid price
     * @param ask        best ask price
     * @param vol24h     24-hour trading volume in base currency
     * @param change24h  24-hour price change percentage (0-based, e.g. 0.05 = +5%)
     * @param updatedAt  timestamp when this snapshot was created
     */
    public record OkxTickerSnapshot(
            String instId,
            BigDecimal last,
            BigDecimal bid,
            BigDecimal ask,
            BigDecimal vol24h,
            BigDecimal change24h,
            Instant updatedAt
    ) {}

    private final ConcurrentHashMap<String, OkxTickerSnapshot> snapshots = new ConcurrentHashMap<>();

    /**
     * Update the cached ticker for an instrument from a WebSocket ticker push.
     *
     * <p>Expected keys in {@code data}: {@code instId}, {@code last}, {@code bidPx},
     * {@code askPx}, {@code vol24h}, {@code open24h}. Missing or unparseable values
     * default to {@link BigDecimal#ZERO}.
     *
     * @param instId instrument ID
     * @param data   raw field map from OKX WebSocket ticker message
     */
    public void updateTicker(String instId, Map<String, String> data) {
        BigDecimal last = safeBigDecimal(data.get("last"));
        BigDecimal bid = safeBigDecimal(data.get("bidPx"));
        BigDecimal ask = safeBigDecimal(data.get("askPx"));
        BigDecimal vol24h = safeBigDecimal(data.get("vol24h"));
        BigDecimal open24h = safeBigDecimal(data.get("open24h"));

        BigDecimal change24h = BigDecimal.ZERO;
        if (open24h.compareTo(BigDecimal.ZERO) > 0 && last.compareTo(BigDecimal.ZERO) > 0) {
            change24h = last.subtract(open24h)
                    .divide(open24h, 6, java.math.RoundingMode.HALF_UP);
        }

        OkxTickerSnapshot snapshot = new OkxTickerSnapshot(
                instId, last, bid, ask, vol24h, change24h, Instant.now()
        );
        snapshots.put(instId, snapshot);

        log.debug("Ticker updated: {} last={} bid={} ask={} vol24h={} chg24h={}",
                instId, last, bid, ask, vol24h, change24h);
    }

    /**
     * Get the last traded price for an instrument.
     *
     * @param instId instrument ID (e.g. "BTC-USDT")
     * @return last price, or {@link BigDecimal#ZERO} if no data available
     */
    public BigDecimal getPrice(String instId) {
        OkxTickerSnapshot snapshot = snapshots.get(instId);
        return snapshot != null ? snapshot.last() : BigDecimal.ZERO;
    }

    /**
     * Get the full ticker snapshot for an instrument.
     *
     * @param instId instrument ID
     * @return snapshot, or {@code null} if no data available
     */
    public OkxTickerSnapshot getSnapshot(String instId) {
        return snapshots.get(instId);
    }

    /**
     * Get all cached ticker snapshots.
     *
     * @return unmodifiable view of the current snapshot map
     */
    public Map<String, OkxTickerSnapshot> getAllSnapshots() {
        return Collections.unmodifiableMap(snapshots);
    }

    // ── Utility ──────────────────────────────────────────────────────────

    private static BigDecimal safeBigDecimal(String value) {
        if (value == null || value.isBlank()) {
            return BigDecimal.ZERO;
        }
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }
}
