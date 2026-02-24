package com.example.finsentinel.service.trading.engine;

import com.example.finsentinel.config.TradingProperties;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.service.MarketDataService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * Factory that creates the correct {@link TradingEngine} implementation based on
 * the requested {@link TradingMode} and available broker configuration.
 *
 * <p>Selection priority for LIVE mode:
 * <ol>
 *   <li>Alpaca (US equities) — if enabled and API key present</li>
 *   <li>Crypto (XChange) — if enabled and API key present</li>
 *   <li>Paper fallback — when no broker is configured</li>
 * </ol>
 *
 * <p>This class belongs to the service/trading layer in FinSentinel.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class TradingEngineFactory {

    private final TradingProperties tradingProperties;
    private final MarketDataService marketDataService;

    /**
     * Creates a trading engine for the given mode and initial cash balance.
     *
     * @param mode        the desired trading mode (PAPER or LIVE)
     * @param initialCash starting cash for paper engines or fallback
     * @return the appropriate {@link TradingEngine} implementation
     */
    public TradingEngine createEngine(TradingMode mode, BigDecimal initialCash) {
        if (mode == TradingMode.LIVE) {
            return createLiveEngine(initialCash);
        }
        return new PaperTradingEngine(marketDataService, initialCash);
    }

    private TradingEngine createLiveEngine(BigDecimal fallbackCash) {
        // Try Alpaca first
        var alpaca = tradingProperties.getAlpaca();
        if (alpaca.isEnabled() && alpaca.getApiKey() != null && !alpaca.getApiKey().isBlank()) {
            String baseUrl = alpaca.isPaper()
                    ? "https://paper-api.alpaca.markets"
                    : "https://api.alpaca.markets";
            log.info("Creating Alpaca trading engine (paper={})", alpaca.isPaper());
            return new AlpacaTradingEngine(alpaca.getApiKey(), alpaca.getSecretKey(), baseUrl);
        }

        // Then try crypto
        var crypto = tradingProperties.getCrypto();
        if (crypto.isEnabled() && crypto.getApiKey() != null && !crypto.getApiKey().isBlank()) {
            log.info("Creating crypto trading engine (exchange={}, sandbox={})",
                    crypto.getExchange(), crypto.isSandbox());
            return new CcxtTradingEngine(
                    crypto.getExchange(), crypto.getApiKey(), crypto.getSecretKey(), crypto.isSandbox());
        }

        // Fallback to paper
        log.warn("LIVE mode requested but no broker configured. Falling back to paper engine.");
        return new PaperTradingEngine(marketDataService, fallbackCash);
    }
}
