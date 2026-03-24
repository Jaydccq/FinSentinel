package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PaperTradingEngine;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PaperBrokerTest {

    @Mock
    PaperTradingEngine engine;

    @Test
    void placeOrder_convertsContractToNativeSymbol_andDelegates() {
        Contract contract = Contract.stock("AAPL");
        OrderRequest request = new OrderRequest(
                "ignored", "buy", "market",
                new BigDecimal("10"), null, null,
                null, "day", false);

        OrderResult expected = new OrderResult(
                true, "paper-1", "filled",
                new BigDecimal("150.00"), new BigDecimal("10"),
                null, LocalDateTime.now());
        when(engine.placeOrder(any(OrderRequest.class))).thenReturn(expected);

        PaperBroker broker = new PaperBroker(engine);
        OrderResult result = broker.placeOrder(contract, request);

        assertThat(result).isEqualTo(expected);

        ArgumentCaptor<OrderRequest> captor = ArgumentCaptor.forClass(OrderRequest.class);
        verify(engine).placeOrder(captor.capture());

        OrderRequest captured = captor.getValue();
        assertThat(captured.symbol()).isEqualTo("AAPL");
        assertThat(captured.side()).isEqualTo("buy");
        assertThat(captured.type()).isEqualTo("market");
        assertThat(captured.qty()).isEqualByComparingTo("10");
    }

    @Test
    void supportedSecurityTypes_includesAllTypes() {
        PaperBroker broker = new PaperBroker(engine);

        assertThat(broker.supportedSecurityTypes())
                .containsExactlyInAnyOrder(SecurityType.values());
    }

    @Test
    void canHandle_returnsTrueForStockContracts() {
        PaperBroker broker = new PaperBroker(engine);

        assertThat(broker.canHandle(Contract.stock("AAPL"))).isTrue();
        assertThat(broker.canHandle(Contract.cryptoPerp("BTC", "USDT", "OKX"))).isTrue();
        assertThat(broker.canHandle(Contract.cryptoSpot("ETH", "USD", "BINANCE"))).isTrue();
    }

    @Test
    void brokerIdAndDisplayName_areCorrect() {
        PaperBroker broker = new PaperBroker(engine);

        assertThat(broker.brokerId()).isEqualTo("paper");
        assertThat(broker.displayName()).isEqualTo("Paper Trading (Simulated)");
    }

    @Test
    void capabilities_containsSpotAndMarketData() {
        PaperBroker broker = new PaperBroker(engine);

        assertThat(broker.capabilities())
                .containsExactlyInAnyOrder(BrokerCapability.SPOT_TRADING, BrokerCapability.MARKET_DATA);
    }

    @Test
    void engine_exposesUnderlyingEngine() {
        PaperBroker broker = new PaperBroker(engine);

        assertThat(broker.engine()).isSameAs(engine);
    }
}
