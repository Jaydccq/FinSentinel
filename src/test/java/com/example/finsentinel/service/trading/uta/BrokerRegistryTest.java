package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.config.TradingProperties;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.okx.OkxApiClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BrokerRegistryTest {

    @Mock
    TradingProperties tradingProperties;

    @Mock
    TradingProperties.AlpacaConfig alpacaConfig;

    @Mock
    TradingProperties.CryptoConfig cryptoConfig;

    @Mock
    MarketDataService marketDataService;

    private static final BigDecimal INITIAL_CASH = new BigDecimal("100000.00");

    private BrokerRegistry createRegistry() {
        return createRegistry(Optional.empty());
    }

    private BrokerRegistry createRegistry(Optional<OkxApiClient> okxApiClient) {
        return new BrokerRegistry(tradingProperties, marketDataService, okxApiClient);
    }

    @Test
    void paperMode_alwaysReturnsPaperBroker() {
        BrokerRegistry registry = createRegistry();
        Contract contract = Contract.stock("AAPL");

        IBroker broker = registry.resolve(contract, TradingMode.PAPER, INITIAL_CASH);

        assertThat(broker).isInstanceOf(PaperBroker.class);
        assertThat(broker.brokerId()).isEqualTo("paper");
    }

    @Test
    void paperMode_handlesAnySecurity() {
        BrokerRegistry registry = createRegistry();

        IBroker stockBroker = registry.resolve(
                Contract.stock("AAPL"), TradingMode.PAPER, INITIAL_CASH);
        IBroker perpBroker = registry.resolve(
                Contract.cryptoPerp("BTC", "USDT", "OKX"), TradingMode.PAPER, INITIAL_CASH);
        IBroker spotBroker = registry.resolve(
                Contract.cryptoSpot("ETH", "USD", "BINANCE"), TradingMode.PAPER, INITIAL_CASH);

        assertThat(stockBroker).isInstanceOf(PaperBroker.class);
        assertThat(perpBroker).isInstanceOf(PaperBroker.class);
        assertThat(spotBroker).isInstanceOf(PaperBroker.class);
    }

    @Test
    void liveMode_noEnabledBroker_throwsException() {
        when(tradingProperties.getAlpaca()).thenReturn(alpacaConfig);
        when(alpacaConfig.isEnabled()).thenReturn(false);
        when(tradingProperties.getCrypto()).thenReturn(cryptoConfig);
        when(cryptoConfig.isEnabled()).thenReturn(false);

        BrokerRegistry registry = createRegistry();
        Contract contract = Contract.stock("AAPL");

        assertThatThrownBy(() -> registry.resolve(contract, TradingMode.LIVE, INITIAL_CASH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("No live broker can handle contract");
    }

    @Test
    void listAvailableBrokers_includesPaperAlways() {
        BrokerRegistry registry = createRegistry();

        List<IBroker> brokers = registry.listAvailableBrokers(TradingMode.PAPER, INITIAL_CASH);

        assertThat(brokers).hasSize(1);
        assertThat(brokers.getFirst().brokerId()).isEqualTo("paper");
    }
}
