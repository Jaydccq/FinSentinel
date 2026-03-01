package com.example.finsentinel.service.okx;

import com.example.finsentinel.service.okx.dto.*;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration smoke tests against live OKX API.
 * Requires: APP_OKX_ENABLED=true and valid OKX credentials in .env
 * Run manually: ./gradlew test --tests "*.OkxIntegrationTest"
 */
@SpringBootTest
@Disabled("Requires live OKX API keys and running infrastructure — run manually")
class OkxIntegrationTest {

    @Autowired
    OkxApiClient client;

    @Test
    void getBalance_returnsSuccess() {
        OkxResponse<OkxAccountBalance> response = client.getBalance();
        assertTrue(response.isSuccess(), "Expected success but got: " + response.msg());
        assertFalse(response.data().isEmpty(), "Balance data should not be empty");
    }

    @Test
    void getPositions_returnsNonNull() {
        OkxResponse<OkxPosition> response = client.getPositions();
        assertNotNull(response);
        // Positions may be empty if no open positions — that's OK
    }

    @Test
    void getTicker_returnsBtcPrice() {
        OkxResponse<OkxTicker> response = client.getTicker("BTC-USDT");
        assertTrue(response.isSuccess(), "Ticker lookup should succeed");
        assertFalse(response.data().isEmpty(), "Should have ticker data");
        assertNotNull(response.data().get(0).last(), "Last price should not be null");
    }

    @Test
    void getFundingRate_returnsBtcSwapRate() {
        OkxResponse<OkxFundingRate> response = client.getFundingRate("BTC-USDT-SWAP");
        assertTrue(response.isSuccess(), "Funding rate lookup should succeed");
        assertFalse(response.data().isEmpty());
        assertNotNull(response.data().get(0).fundingRate());
    }

    @Test
    void getPendingOrders_returnsSuccess() {
        OkxResponse<OkxOrder> response = client.getPendingOrders();
        assertTrue(response.isSuccess());
        // May be empty if no pending orders
    }
}
