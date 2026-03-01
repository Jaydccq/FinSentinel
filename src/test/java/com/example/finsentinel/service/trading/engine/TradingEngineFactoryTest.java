package com.example.finsentinel.service.trading.engine;

import com.example.finsentinel.config.TradingProperties;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.okx.OkxApiClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@ExtendWith(MockitoExtension.class)
class TradingEngineFactoryTest {

    @Mock
    private MarketDataService marketDataService;

    @Mock
    private OkxApiClient okxApiClient;

    @Test
    void paperMode_returnsPaperEngine() {
        TradingProperties props = new TradingProperties();
        TradingEngineFactory factory = new TradingEngineFactory(props, marketDataService, Optional.empty());

        TradingEngine engine = factory.createEngine(TradingMode.PAPER, new BigDecimal("100000"));

        assertThat(engine.engineName()).isEqualTo("paper");
    }

    @Test
    void liveMode_withoutConfiguredBroker_throws() {
        TradingProperties props = new TradingProperties();
        props.getAlpaca().setEnabled(false);
        TradingEngineFactory factory = new TradingEngineFactory(props, marketDataService, Optional.empty());

        assertThatThrownBy(() -> factory.createEngine(TradingMode.LIVE, new BigDecimal("0")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no live broker is configured");
    }

    @Test
    void liveMode_alpacaEnabled_returnsAlpacaEngine() {
        TradingProperties props = new TradingProperties();
        props.getAlpaca().setEnabled(true);
        props.getAlpaca().setApiKey("test-key");
        props.getAlpaca().setSecretKey("test-secret");
        TradingEngineFactory factory = new TradingEngineFactory(props, marketDataService, Optional.empty());

        TradingEngine engine = factory.createEngine(TradingMode.LIVE, new BigDecimal("0"));

        assertThat(engine.engineName()).isEqualTo("alpaca");
    }

    @Test
    void liveMode_okxPresent_returnsOkxEngine() {
        TradingProperties props = new TradingProperties();
        props.getAlpaca().setEnabled(false);
        TradingEngineFactory factory = new TradingEngineFactory(
                props, marketDataService, Optional.of(okxApiClient));

        TradingEngine engine = factory.createEngine(TradingMode.LIVE, new BigDecimal("0"));

        assertThat(engine.engineName()).isEqualTo("crypto-okx");
    }

    @Test
    void liveMode_alpacaPreferredOverOkx() {
        TradingProperties props = new TradingProperties();
        props.getAlpaca().setEnabled(true);
        props.getAlpaca().setApiKey("test-key");
        props.getAlpaca().setSecretKey("test-secret");
        TradingEngineFactory factory = new TradingEngineFactory(
                props, marketDataService, Optional.of(okxApiClient));

        TradingEngine engine = factory.createEngine(TradingMode.LIVE, new BigDecimal("0"));

        assertThat(engine.engineName()).isEqualTo("alpaca");
    }
}
