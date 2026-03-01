package com.example.finsentinel.controller;

import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.OkxTradingEngine;
import com.example.finsentinel.service.okx.dto.*;
import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PositionInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link OkxController}.
 *
 * <p>Uses Mockito standalone (no Spring context). Mocks {@link OkxApiClient},
 * creates a real {@link OkxTradingEngine} wrapping the mock, and injects both
 * into the controller via reflection to bypass {@code @PostConstruct}.
 */
@ExtendWith(MockitoExtension.class)
class OkxControllerTest {

    @Mock private OkxApiClient okxApiClient;

    private OkxController controller;

    @BeforeEach
    void setUp() throws Exception {
        controller = new OkxController(okxApiClient);
        // Trigger @PostConstruct manually since we're outside Spring context
        controller.init();
    }

    // ── Account ─────────────────────────────────────────────────────────

    @Test
    void getAccount_returnsAccountInfo() {
        OkxAccountBalance balance = new OkxAccountBalance(
                "50000.00", null, null, null, "5000.00", null, null, null,
                List.of(new OkxAccountBalance.BalanceDetail(
                        "USDT", "45000.00", "40000.00", "35000.00",
                        "5000.00", "1200.50", null, null, null, null
                ))
        );
        when(okxApiClient.getBalance())
                .thenReturn(new OkxResponse<>("0", "", List.of(balance)));

        ResponseEntity<AccountInfo> response = controller.getAccount();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        AccountInfo account = response.getBody();
        assertThat(account).isNotNull();
        assertThat(account.equity()).isEqualByComparingTo(new BigDecimal("50000.00"));
        assertThat(account.unrealizedPnL()).isEqualByComparingTo(new BigDecimal("1200.50"));
    }

    @Test
    void getAccount_apiFailure_returnsZeroAccount() {
        when(okxApiClient.getBalance())
                .thenReturn(new OkxResponse<>("1", "API error", List.of()));

        ResponseEntity<AccountInfo> response = controller.getAccount();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        AccountInfo account = response.getBody();
        assertThat(account).isNotNull();
        assertThat(account.equity()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    // ── Balance Details ─────────────────────────────────────────────────

    @Test
    void getBalanceDetails_returnsList() {
        OkxAccountBalance.BalanceDetail detail = new OkxAccountBalance.BalanceDetail(
                "BTC", "1.5", "1.5", "1.2", "0.3", "0.05", null, null, null, null
        );
        OkxAccountBalance balance = new OkxAccountBalance(
                "50000.00", null, null, null, null, null, null, null, List.of(detail));
        when(okxApiClient.getBalance())
                .thenReturn(new OkxResponse<>("0", "", List.of(balance)));

        ResponseEntity<List<OkxAccountBalance.BalanceDetail>> response = controller.getBalanceDetails();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().getFirst().ccy()).isEqualTo("BTC");
    }

    // ── Positions ───────────────────────────────────────────────────────

    @Test
    void getPositions_returnsMappedList() {
        OkxPosition position = new OkxPosition(
                "BTC-USDT-SWAP", "SWAP", "long", "0.5",
                "42000.00", "43500.00", "35000.00", "750.00",
                "0.036", "10", "cross", "2100.00",
                "2100.00", "100.00", "21750.00", "43500.00",
                "1700000000000", "1700000001000"
        );
        when(okxApiClient.getPositions())
                .thenReturn(new OkxResponse<>("0", "", List.of(position)));

        ResponseEntity<List<PositionInfo>> response = controller.getPositions();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        List<PositionInfo> positions = response.getBody();
        assertThat(positions).hasSize(1);
        assertThat(positions.getFirst().symbol()).isEqualTo("BTC-USDT-SWAP");
        assertThat(positions.getFirst().side()).isEqualTo("long");
        assertThat(positions.getFirst().qty()).isEqualByComparingTo(new BigDecimal("0.5"));
    }

    @Test
    void getPositions_emptyOnApiFailure() {
        when(okxApiClient.getPositions())
                .thenReturn(new OkxResponse<>("1", "Timeout", List.of()));

        ResponseEntity<List<PositionInfo>> response = controller.getPositions();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEmpty();
    }

    // ── Pending Orders ──────────────────────────────────────────────────

    @Test
    void getPendingOrders_returnsMappedList() {
        OkxOrder order = new OkxOrder(
                "ETH-USDT", "12345", null, "buy", "limit", null,
                "1.0", "2500.00", null, "0", "live",
                "cash", null, null, null, "1700000000000", "1700000000000"
        );
        when(okxApiClient.getPendingOrders())
                .thenReturn(new OkxResponse<>("0", "", List.of(order)));

        ResponseEntity<List<OrderResult>> response = controller.getPendingOrders();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        List<OrderResult> orders = response.getBody();
        assertThat(orders).hasSize(1);
        assertThat(orders.getFirst().orderId()).isEqualTo("12345");
        assertThat(orders.getFirst().status()).isEqualTo("pending");
    }

    // ── Order History ───────────────────────────────────────────────────

    @Test
    void getOrderHistory_delegatesToEngine() {
        OkxOrder filledOrder = new OkxOrder(
                "BTC-USDT", "99999", null, "sell", "market", null,
                "0.1", null, "43200.00", "0.1", "filled",
                "cash", null, "-0.5", "120.00", "1700000000000", "1700000001000"
        );
        when(okxApiClient.getOrderHistory("SPOT"))
                .thenReturn(new OkxResponse<>("0", "", List.of(filledOrder)));

        ResponseEntity<List<OkxOrder>> response = controller.getOrderHistory("SPOT");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().getFirst().ordId()).isEqualTo("99999");
        assertThat(response.getBody().getFirst().state()).isEqualTo("filled");
    }

    @Test
    void getOrderHistory_usesDefaultInstType() {
        when(okxApiClient.getOrderHistory("SPOT"))
                .thenReturn(new OkxResponse<>("0", "", List.of()));

        ResponseEntity<List<OkxOrder>> response = controller.getOrderHistory("SPOT");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEmpty();
    }

    // ── Funding Rate ────────────────────────────────────────────────────

    @Test
    void getFundingRate_returnsRate() {
        OkxFundingRate rate = new OkxFundingRate(
                "BTC-USDT-SWAP", "SWAP", "0.0001", "0.00015",
                "1700000000000", "1700028800000"
        );
        when(okxApiClient.getFundingRate("BTC-USDT-SWAP"))
                .thenReturn(new OkxResponse<>("0", "", List.of(rate)));

        ResponseEntity<OkxFundingRate> response = controller.getFundingRate("BTC-USDT-SWAP");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        OkxFundingRate body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.instId()).isEqualTo("BTC-USDT-SWAP");
        assertThat(body.fundingRate()).isEqualTo("0.0001");
    }

    @Test
    void getFundingRate_notFound_returns404() {
        when(okxApiClient.getFundingRate("INVALID-SWAP"))
                .thenReturn(new OkxResponse<>("1", "Not found", List.of()));

        ResponseEntity<OkxFundingRate> response = controller.getFundingRate("INVALID-SWAP");

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    // ── Ticker ──────────────────────────────────────────────────────────

    @Test
    void getTicker_returnsTicker() {
        OkxTicker ticker = new OkxTicker(
                "BTC-USDT", "SPOT", "43500.00", "0.01",
                "43501.00", "1.5", "43499.00", "2.0",
                "42000.00", "44000.00", "41500.00",
                "12345.67", "537037162.50", "1700000000000"
        );
        when(okxApiClient.getTicker("BTC-USDT"))
                .thenReturn(new OkxResponse<>("0", "", List.of(ticker)));

        ResponseEntity<OkxTicker> response = controller.getTicker("BTC-USDT");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        OkxTicker body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.instId()).isEqualTo("BTC-USDT");
        assertThat(body.last()).isEqualTo("43500.00");
    }

    @Test
    void getTicker_notFound_returns404() {
        when(okxApiClient.getTicker("INVALID"))
                .thenReturn(new OkxResponse<>("1", "Instrument not found", List.of()));

        ResponseEntity<OkxTicker> response = controller.getTicker("INVALID");

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }
}
