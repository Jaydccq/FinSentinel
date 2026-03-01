package com.example.finsentinel.service.okx;

import com.example.finsentinel.config.OkxProperties;
import com.example.finsentinel.service.okx.dto.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * OKX v5 REST API client with HMAC-SHA256 authentication.
 *
 * <p>Uses Java 21's built-in {@link HttpClient} with HTTP/2. Every request is
 * signed per OKX's specification: {@code Base64(HMAC-SHA256(timestamp + METHOD
 * + requestPath + body, secretKey))} with four auth headers.
 *
 * <p>On any error the client returns {@code OkxResponse("1", errorMsg, [])}
 * instead of throwing, so callers can always pattern-match on {@code isSuccess()}.
 */
@Service
@Slf4j
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class OkxApiClient {

    private static final String HMAC_SHA256 = "HmacSHA256";
    private static final DateTimeFormatter TIMESTAMP_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
                    .withZone(ZoneOffset.UTC);

    private final OkxProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public OkxApiClient(OkxProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_2)
                .build();
    }

    // ── Account ─────────────────────────────────────────────────────────

    /** Get account balance across all currencies. */
    public OkxResponse<OkxAccountBalance> getBalance() {
        return get("/api/v5/account/balance", new TypeReference<>() {});
    }

    /** Get current positions. */
    public OkxResponse<OkxPosition> getPositions() {
        return get("/api/v5/account/positions", new TypeReference<>() {});
    }

    /** Get account configuration (trade mode, leverage, etc.). */
    public OkxResponse<Map<String, Object>> getAccountConfig() {
        return get("/api/v5/account/config", new TypeReference<>() {});
    }

    // ── Market ──────────────────────────────────────────────────────────

    /** Get ticker for a single instrument. */
    public OkxResponse<OkxTicker> getTicker(String instId) {
        return get("/api/v5/market/ticker?instId=" + instId, new TypeReference<>() {});
    }

    /** Get all tickers for an instrument type (SPOT, SWAP, FUTURES, OPTION). */
    public OkxResponse<OkxTicker> getTickers(String instType) {
        return get("/api/v5/market/tickers?instType=" + instType, new TypeReference<>() {});
    }

    /** Get current funding rate for a perpetual swap. */
    public OkxResponse<OkxFundingRate> getFundingRate(String instId) {
        return get("/api/v5/public/funding-rate?instId=" + instId, new TypeReference<>() {});
    }

    /** Get mark price for an instrument. */
    public OkxResponse<OkxTicker> getMarkPrice(String instId, String instType) {
        return get("/api/v5/public/mark-price?instId=" + instId + "&instType=" + instType,
                new TypeReference<>() {});
    }

    // ── Trade ───────────────────────────────────────────────────────────

    /** Place a new order. */
    public OkxResponse<OkxOrder> placeOrder(Map<String, Object> body) {
        return post("/api/v5/trade/order", body, new TypeReference<>() {});
    }

    /** Cancel an existing order. */
    public OkxResponse<OkxOrder> cancelOrder(String instId, String ordId) {
        return post("/api/v5/trade/cancel-order",
                Map.of("instId", instId, "ordId", ordId),
                new TypeReference<>() {});
    }

    /** Get pending (unfilled) orders. */
    public OkxResponse<OkxOrder> getPendingOrders() {
        return get("/api/v5/trade/orders-pending", new TypeReference<>() {});
    }

    /** Get order history for an instrument type. */
    public OkxResponse<OkxOrder> getOrderHistory(String instType) {
        return get("/api/v5/trade/orders-history-archive?instType=" + instType,
                new TypeReference<>() {});
    }

    // ── Margin ──────────────────────────────────────────────────────────

    /** Set leverage for an instrument. */
    public OkxResponse<Map<String, Object>> setLeverage(String instId, String lever, String mgnMode) {
        return post("/api/v5/account/set-leverage",
                Map.of("instId", instId, "lever", lever, "mgnMode", mgnMode),
                new TypeReference<>() {});
    }

    // ── Internal Helpers ────────────────────────────────────────────────

    /**
     * Signed GET request.
     */
    private <T> OkxResponse<T> get(String path, TypeReference<OkxResponse<T>> typeRef) {
        try {
            String timestamp = getTimestamp();
            String signature = sign(timestamp, "GET", path, "");

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(properties.getBaseUrl() + path))
                    .GET()
                    .header("Content-Type", "application/json")
                    .header("OK-ACCESS-KEY", properties.getApiKey())
                    .header("OK-ACCESS-SIGN", signature)
                    .header("OK-ACCESS-TIMESTAMP", timestamp)
                    .header("OK-ACCESS-PASSPHRASE", properties.getPassphrase());

            if (properties.isSandbox()) {
                builder.header("x-simulated-trading", "1");
            }

            HttpResponse<String> response = httpClient.send(
                    builder.build(), HttpResponse.BodyHandlers.ofString());

            log.debug("OKX GET {} → {}", path, response.statusCode());
            return objectMapper.readValue(response.body(), typeRef);
        } catch (Exception e) {
            log.error("OKX GET {} failed: {}", path, e.getMessage());
            return new OkxResponse<>("1", e.getMessage(), List.of());
        }
    }

    /**
     * Signed POST request.
     */
    private <T> OkxResponse<T> post(String path, Object body, TypeReference<OkxResponse<T>> typeRef) {
        try {
            String bodyJson = objectMapper.writeValueAsString(body);
            String timestamp = getTimestamp();
            String signature = sign(timestamp, "POST", path, bodyJson);

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(properties.getBaseUrl() + path))
                    .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
                    .header("Content-Type", "application/json")
                    .header("OK-ACCESS-KEY", properties.getApiKey())
                    .header("OK-ACCESS-SIGN", signature)
                    .header("OK-ACCESS-TIMESTAMP", timestamp)
                    .header("OK-ACCESS-PASSPHRASE", properties.getPassphrase());

            if (properties.isSandbox()) {
                builder.header("x-simulated-trading", "1");
            }

            HttpResponse<String> response = httpClient.send(
                    builder.build(), HttpResponse.BodyHandlers.ofString());

            log.debug("OKX POST {} → {}", path, response.statusCode());
            return objectMapper.readValue(response.body(), typeRef);
        } catch (Exception e) {
            log.error("OKX POST {} failed: {}", path, e.getMessage());
            return new OkxResponse<>("1", e.getMessage(), List.of());
        }
    }

    /**
     * HMAC-SHA256 signature per OKX v5 specification.
     *
     * <p>Signature = Base64(HMAC-SHA256(timestamp + method + requestPath + body, secretKey))
     *
     * <p>Package-private for unit testing.
     */
    String sign(String timestamp, String method, String requestPath, String body) {
        try {
            String prehash = timestamp + method + requestPath + body;
            Mac mac = Mac.getInstance(HMAC_SHA256);
            SecretKeySpec keySpec = new SecretKeySpec(
                    properties.getSecretKey().getBytes(StandardCharsets.UTF_8), HMAC_SHA256);
            mac.init(keySpec);
            byte[] hash = mac.doFinal(prehash.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to compute HMAC-SHA256 signature", e);
        }
    }

    /**
     * ISO timestamp in UTC: {@code yyyy-MM-dd'T'HH:mm:ss.SSS'Z'}.
     *
     * <p>Package-private for unit testing.
     */
    String getTimestamp() {
        return TIMESTAMP_FMT.format(Instant.now());
    }
}
