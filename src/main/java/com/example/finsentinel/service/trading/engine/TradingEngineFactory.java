package com.example.finsentinel.service.trading.engine;

import com.example.finsentinel.config.TradingProperties;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.OkxTradingEngine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Optional;

/**
 * Factory that creates the correct {@link TradingEngine} implementation based on
 * the requested {@link TradingMode} and available broker configuration.
 *
 * <p>Selection priority for LIVE mode:
 * <ol>
 *   <li>Alpaca (US equities) — if enabled and API key present</li>
 *   <li>OKX (direct API) — if bean present (gated by {@code app.trading.okx.enabled})</li>
 *   <li>Crypto (XChange) — if enabled and API key present</li>
 *   <li>Fail fast — throws when no live broker is configured</li>
 * </ol>
 *
 * <p>This class belongs to the service/trading layer in FinSentinel.
 *
 * @deprecated Use {@link com.example.finsentinel.service.trading.uta.BrokerRegistry} instead.
 */
@Deprecated(forRemoval = true)
@Component
@Slf4j
public class TradingEngineFactory {

    private final TradingProperties tradingProperties;
    private final MarketDataService marketDataService;
    private final OkxApiClient okxApiClient;

    /**
     * Constructor with optional OKX dependency.
     *
     * <p>{@link OkxApiClient} is {@code @ConditionalOnProperty}-gated, so it may not
     * exist in the application context. Spring autowires {@link Optional#empty()} when
     * the bean is absent, avoiding startup failures.
     */
    public TradingEngineFactory(TradingProperties tradingProperties,
                                MarketDataService marketDataService,
                                Optional<OkxApiClient> okxApiClient) {
        this.tradingProperties = tradingProperties;
        this.marketDataService = marketDataService;
        this.okxApiClient = okxApiClient.orElse(null);
    }

    /**
     * Creates a trading engine for the given mode and initial cash balance.
     *
     * @param mode        the desired trading mode (PAPER or LIVE)
     * @param initialCash starting cash for paper engines or fallback
     * @return the appropriate {@link TradingEngine} implementation
     */
    public TradingEngine createEngine(TradingMode mode, BigDecimal initialCash) {
        if (mode == TradingMode.LIVE) {
            return createLiveEngine();
        }
        return new PaperTradingEngine(marketDataService, initialCash);
    }

    private TradingEngine createLiveEngine() {
        // Try Alpaca first (US equities)
        var alpaca = tradingProperties.getAlpaca();
        if (alpaca.isEnabled() && alpaca.getApiKey() != null && !alpaca.getApiKey().isBlank()) {
            String baseUrl = alpaca.isPaper()
                    ? "https://paper-api.alpaca.markets"
                    : "https://api.alpaca.markets";
            log.info("Creating Alpaca trading engine (paper={})", alpaca.isPaper());
            return new AlpacaTradingEngine(alpaca.getApiKey(), alpaca.getSecretKey(), baseUrl);
        }

        // Try OKX (direct API — higher priority than generic CCXT)
        if (okxApiClient != null) {
            log.info("Creating OKX trading engine");
            return new OkxTradingEngine(okxApiClient);
        }

        // Then try generic crypto (XChange/CCXT)
        var crypto = tradingProperties.getCrypto();
        if (crypto.isEnabled() && crypto.getApiKey() != null && !crypto.getApiKey().isBlank()) {
            log.info("Creating crypto trading engine (exchange={}, sandbox={})",
                    crypto.getExchange(), crypto.isSandbox());
            return new CcxtTradingEngine(
                    crypto.getExchange(), crypto.getApiKey(), crypto.getSecretKey(), crypto.isSandbox());
        }

        throw new IllegalStateException(
                "LIVE trading mode requested, but no live broker is configured. " +
                        "Configure Alpaca/OKX/Crypto broker credentials or switch to PAPER mode.");
    }
}
