package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.config.TradingProperties;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.OkxTradingEngine;
import com.example.finsentinel.service.trading.engine.AlpacaTradingEngine;
import com.example.finsentinel.service.trading.engine.CcxtTradingEngine;
import com.example.finsentinel.service.trading.engine.PaperTradingEngine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Contract-aware broker resolution registry.
 *
 * <p>Replaces the legacy {@code TradingEngineFactory} with Contract-based routing.
 * In PAPER mode, always returns a {@link PaperBroker}. In LIVE mode, builds
 * a priority-ordered list of brokers (Alpaca > OKX > CCXT) and selects the
 * first that can handle the given {@link Contract}.
 *
 * <p>Not a singleton cache — brokers are created per-call so each user/wallet
 * can have its own engine instance (especially important for PaperTradingEngine
 * which holds per-user state).
 */
@Component
@Slf4j
public class BrokerRegistry {

    private final TradingProperties tradingProperties;
    private final MarketDataService marketDataService;
    private final OkxApiClient okxApiClient;

    /**
     * Constructor with optional OKX dependency.
     *
     * <p>{@link OkxApiClient} is {@code @ConditionalOnProperty}-gated, so it may not
     * exist in the application context. Spring autowires {@link Optional#empty()} when
     * the bean is absent.
     */
    public BrokerRegistry(TradingProperties tradingProperties,
                          MarketDataService marketDataService,
                          Optional<OkxApiClient> okxApiClient) {
        this.tradingProperties = tradingProperties;
        this.marketDataService = marketDataService;
        this.okxApiClient = okxApiClient.orElse(null);
    }

    /**
     * Resolve the correct broker for a contract and trading mode.
     *
     * <ul>
     *   <li>PAPER &rarr; always {@link PaperBroker} (handles all security types)</li>
     *   <li>LIVE &rarr; match by security type, priority: Alpaca &gt; OKX &gt; CCXT</li>
     * </ul>
     *
     * @param contract    the contract to trade
     * @param mode        PAPER or LIVE
     * @param initialCash starting cash for paper engine
     * @return the resolved broker
     * @throws IllegalStateException if no live broker can handle the contract
     */
    public IBroker resolve(Contract contract, TradingMode mode, BigDecimal initialCash) {
        if (mode == TradingMode.PAPER) {
            log.debug("Resolving paper broker for contract: {}", contract.displayName());
            return new PaperBroker(new PaperTradingEngine(marketDataService, initialCash));
        }

        List<IBroker> liveBrokers = buildLiveBrokers();
        return liveBrokers.stream()
                .filter(broker -> broker.canHandle(contract))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "No live broker can handle contract: " + contract.displayName()
                                + " (secType=" + contract.secType() + "). "
                                + "Configure Alpaca/OKX/Crypto broker credentials or switch to PAPER mode."));
    }

    /**
     * List all brokers available in the given mode (useful for AI search/discovery).
     *
     * @param mode        PAPER or LIVE
     * @param initialCash starting cash for paper engine
     * @return list of available brokers
     */
    public List<IBroker> listAvailableBrokers(TradingMode mode, BigDecimal initialCash) {
        if (mode == TradingMode.PAPER) {
            return List.of(new PaperBroker(new PaperTradingEngine(marketDataService, initialCash)));
        }
        return buildLiveBrokers();
    }

    /**
     * Builds the priority-ordered list of live brokers based on configuration.
     * Priority: Alpaca > OKX > CCXT.
     */
    private List<IBroker> buildLiveBrokers() {
        List<IBroker> brokers = new ArrayList<>();

        // 1. Alpaca (US equities) — highest priority
        var alpaca = tradingProperties.getAlpaca();
        if (alpaca.isEnabled() && alpaca.getApiKey() != null && !alpaca.getApiKey().isBlank()) {
            String baseUrl = alpaca.isPaper()
                    ? "https://paper-api.alpaca.markets"
                    : "https://api.alpaca.markets";
            log.info("Live broker available: Alpaca (paper={})", alpaca.isPaper());
            brokers.add(new AlpacaBroker(
                    new AlpacaTradingEngine(alpaca.getApiKey(), alpaca.getSecretKey(), baseUrl)));
        }

        // 2. OKX (crypto derivatives) — if bean present
        if (okxApiClient != null) {
            log.info("Live broker available: OKX");
            brokers.add(new OkxBroker(new OkxTradingEngine(okxApiClient)));
        }

        // 3. CCXT (generic crypto spot) — lowest priority
        var crypto = tradingProperties.getCrypto();
        if (crypto.isEnabled() && crypto.getApiKey() != null && !crypto.getApiKey().isBlank()) {
            log.info("Live broker available: CCXT (exchange={}, sandbox={})",
                    crypto.getExchange(), crypto.isSandbox());
            brokers.add(new CcxtBroker(
                    new CcxtTradingEngine(crypto.getExchange(), crypto.getApiKey(),
                            crypto.getSecretKey(), crypto.isSandbox())));
        }

        return brokers;
    }
}
