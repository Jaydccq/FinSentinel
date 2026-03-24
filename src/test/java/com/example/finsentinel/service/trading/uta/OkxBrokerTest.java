package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.okx.OkxTradingEngine;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
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
class OkxBrokerTest {

    @Mock
    OkxTradingEngine engine;

    @Test
    void placeOrder_withCryptoPerpContract_convertsToOkxSwapSymbol() {
        Contract contract = Contract.cryptoPerp("BTC", "USDT", "OKX");
        OrderRequest request = new OrderRequest(
                "ignored", "buy", "market",
                new BigDecimal("0.1"), null, null,
                null, "gtc", false);

        OrderResult expected = new OrderResult(
                true, "okx-123", "filled",
                new BigDecimal("42000.00"), new BigDecimal("0.1"),
                null, LocalDateTime.now());
        when(engine.placeOrder(any(OrderRequest.class))).thenReturn(expected);

        OkxBroker broker = new OkxBroker(engine);
        OrderResult result = broker.placeOrder(contract, request);

        assertThat(result).isEqualTo(expected);

        ArgumentCaptor<OrderRequest> captor = ArgumentCaptor.forClass(OrderRequest.class);
        verify(engine).placeOrder(captor.capture());

        OrderRequest captured = captor.getValue();
        assertThat(captured.symbol()).isEqualTo("BTC-USDT-SWAP");
        assertThat(captured.side()).isEqualTo("buy");
        assertThat(captured.type()).isEqualTo("market");
        assertThat(captured.qty()).isEqualByComparingTo("0.1");
    }

    @Test
    void supportedSecurityTypes_containsCryptoAndPerp() {
        OkxBroker broker = new OkxBroker(engine);

        assertThat(broker.supportedSecurityTypes())
                .containsExactlyInAnyOrder(SecurityType.CRYPTO, SecurityType.PERP);
    }

    @Test
    void canHandle_returnsFalseForStock() {
        OkxBroker broker = new OkxBroker(engine);

        assertThat(broker.canHandle(Contract.stock("AAPL"))).isFalse();
        assertThat(broker.canHandle(Contract.cryptoPerp("BTC", "USDT", "OKX"))).isTrue();
        assertThat(broker.canHandle(Contract.cryptoSpot("ETH", "USD", "BINANCE"))).isTrue();
    }

    @Test
    void brokerIdAndDisplayName_areCorrect() {
        OkxBroker broker = new OkxBroker(engine);

        assertThat(broker.brokerId()).isEqualTo("okx");
        assertThat(broker.displayName()).isEqualTo("OKX (Crypto Derivatives)");
    }

    @Test
    void capabilities_containsExpectedSet() {
        OkxBroker broker = new OkxBroker(engine);

        assertThat(broker.capabilities()).containsExactlyInAnyOrder(
                BrokerCapability.SPOT_TRADING,
                BrokerCapability.PERPETUAL_SWAP,
                BrokerCapability.MARGIN_TRADING,
                BrokerCapability.MARKET_DATA,
                BrokerCapability.ORDER_MANAGEMENT);
    }

    @Test
    void engine_exposesUnderlyingForOkxSpecificOps() {
        OkxBroker broker = new OkxBroker(engine);

        assertThat(broker.engine()).isSameAs(engine);
    }
}
