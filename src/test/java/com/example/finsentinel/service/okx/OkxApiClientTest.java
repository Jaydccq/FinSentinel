package com.example.finsentinel.service.okx;

import com.example.finsentinel.config.OkxProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link OkxApiClient} — signature generation and timestamp format.
 *
 * <p>These tests verify the HMAC-SHA256 signing logic without hitting the OKX API.
 * The client is instantiated directly (no Spring context needed).
 */
class OkxApiClientTest {

    private OkxApiClient client;

    @BeforeEach
    void setUp() {
        OkxProperties props = new OkxProperties();
        props.setApiKey("test-api-key");
        props.setSecretKey("test-secret-key");
        props.setPassphrase("test-passphrase");
        props.setBaseUrl("https://www.okx.com");
        props.setSandbox(false);

        client = new OkxApiClient(props, new ObjectMapper());
    }

    @Test
    void sign_producesConsistentHmacSha256() {
        String timestamp = "2026-03-01T00:00:00.000Z";
        String sig1 = client.sign(timestamp, "GET", "/api/v5/account/balance", "");
        String sig2 = client.sign(timestamp, "GET", "/api/v5/account/balance", "");

        assertNotNull(sig1);
        assertFalse(sig1.isBlank());
        assertEquals(sig1, sig2, "Same inputs must produce the same signature");
    }

    @Test
    void sign_differentPathsProduceDifferentSignatures() {
        String timestamp = "2026-03-01T00:00:00.000Z";
        String sigBalance = client.sign(timestamp, "GET", "/api/v5/account/balance", "");
        String sigPositions = client.sign(timestamp, "GET", "/api/v5/account/positions", "");

        assertNotEquals(sigBalance, sigPositions,
                "Different paths must produce different signatures");
    }

    @Test
    void sign_postWithBodyDiffersFromGet() {
        String timestamp = "2026-03-01T00:00:00.000Z";
        String path = "/api/v5/trade/order";
        String body = "{\"instId\":\"BTC-USDT\",\"side\":\"buy\",\"sz\":\"0.01\"}";

        String sigGet = client.sign(timestamp, "GET", path, "");
        String sigPost = client.sign(timestamp, "POST", path, body);

        assertNotEquals(sigGet, sigPost,
                "POST with body must differ from GET without body");
    }

    @Test
    void getTimestamp_returnsIsoFormat() {
        String timestamp = client.getTimestamp();

        assertNotNull(timestamp);
        assertTrue(timestamp.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"),
                "Timestamp must match ISO format yyyy-MM-dd'T'HH:mm:ss.SSSZ, got: " + timestamp);
    }
}
