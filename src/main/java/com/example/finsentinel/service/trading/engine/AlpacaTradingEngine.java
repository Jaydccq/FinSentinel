package com.example.finsentinel.service.trading.engine;

import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Alpaca Markets trading engine for US equities.
 *
 * <p>Communicates with the Alpaca REST API v2 using Java 21's built-in {@link HttpClient}.
 * Not a Spring bean — instantiated by the {@code TradingEngineFactory}.
 *
 * <p>Default base URL targets the Alpaca paper-trading sandbox.
 */
@Slf4j
public class AlpacaTradingEngine implements TradingEngine {

    private static final String DEFAULT_BASE_URL = "https://paper-api.alpaca.markets";
    private static final ObjectMapper objectMapper = JsonMapper.builder().build();

    private final String apiKey;
    private final String secretKey;
    private final String baseUrl;
    private final HttpClient httpClient;

    public AlpacaTradingEngine(String apiKey, String secretKey, String baseUrl) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.baseUrl = (baseUrl != null) ? baseUrl : DEFAULT_BASE_URL;
        this.httpClient = HttpClient.newHttpClient();
    }

    // ──────────────────────────────── TradingEngine contract ────────────────────

    @Override
    public String engineName() {
        return "alpaca";
    }

    @Override
    public OrderResult placeOrder(OrderRequest request) {
        try {
            Map<String, Object> body = buildOrderBody(request);
            String json = objectMapper.writeValueAsString(body);

            HttpResponse<String> response = sendPost("/v2/orders", json);
            JsonNode node = objectMapper.readTree(response.body());

            return parseOrderNode(node);
        } catch (Exception e) {
            log.error("Alpaca placeOrder failed for {}: {}", request.symbol(), e.getMessage(), e);
            String errorMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            return new OrderResult(false, null, "rejected", BigDecimal.ZERO, BigDecimal.ZERO,
                    errorMsg, null);
        }
    }

    @Override
    public List<PositionInfo> getPositions() {
        try {
            HttpResponse<String> response = sendGet("/v2/positions");
            JsonNode array = objectMapper.readTree(response.body());

            List<PositionInfo> positions = new ArrayList<>();
            for (JsonNode node : array) {
                positions.add(new PositionInfo(
                        node.get("symbol").asText(),
                        node.get("side").asText(),
                        new BigDecimal(node.get("qty").asText()),
                        new BigDecimal(node.get("avg_entry_price").asText()),
                        new BigDecimal(node.get("current_price").asText()),
                        new BigDecimal(node.get("market_value").asText()),
                        new BigDecimal(node.get("unrealized_pl").asText()),
                        new BigDecimal(node.get("cost_basis").asText())
                ));
            }
            return positions;
        } catch (Exception e) {
            log.error("Alpaca getPositions failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public List<OrderResult> getOrders() {
        try {
            HttpResponse<String> response = sendGet("/v2/orders?status=all&limit=50");
            JsonNode array = objectMapper.readTree(response.body());

            List<OrderResult> orders = new ArrayList<>();
            for (JsonNode node : array) {
                orders.add(parseOrderNode(node));
            }
            return orders;
        } catch (Exception e) {
            log.error("Alpaca getOrders failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public List<OrderResult> syncOrders() {
        try {
            HttpResponse<String> response = sendGet("/v2/orders?status=open&limit=50");
            JsonNode array = objectMapper.readTree(response.body());
            List<OrderResult> orders = new ArrayList<>();
            for (JsonNode node : array) {
                orders.add(parseOrderNode(node));
            }
            return orders;
        } catch (Exception e) {
            log.error("Alpaca syncOrders failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public AccountInfo getAccount() {
        try {
            HttpResponse<String> response = sendGet("/v2/account");
            JsonNode node = objectMapper.readTree(response.body());

            return new AccountInfo(
                    new BigDecimal(node.get("cash").asText()),
                    new BigDecimal(node.get("portfolio_value").asText()),
                    new BigDecimal(node.get("equity").asText()),
                    new BigDecimal(node.get("buying_power").asText()),
                    node.has("unrealized_pl") && !node.get("unrealized_pl").isNull()
                            ? new BigDecimal(node.get("unrealized_pl").asText()) : BigDecimal.ZERO,
                    node.has("realized_pl") && !node.get("realized_pl").isNull()
                            ? new BigDecimal(node.get("realized_pl").asText()) : BigDecimal.ZERO
            );
        } catch (Exception e) {
            log.error("Alpaca getAccount failed: {}", e.getMessage(), e);
            return new AccountInfo(
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO
            );
        }
    }

    @Override
    public boolean cancelOrder(String orderId) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v2/orders/" + orderId))
                    .header("APCA-API-KEY-ID", apiKey)
                    .header("APCA-API-SECRET-KEY", secretKey)
                    .DELETE()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            checkStatus(response);
            return true;
        } catch (Exception e) {
            log.error("Alpaca cancelOrder failed for {}: {}", orderId, e.getMessage(), e);
            return false;
        }
    }

    // ──────────────────────────────── Order parsing ────────────────────────────

    private OrderResult parseOrderNode(JsonNode node) {
        return new OrderResult(
                true,
                node.get("id").asText(),
                mapOrderStatus(node.get("status").asText()),
                node.has("filled_avg_price") && !node.get("filled_avg_price").isNull()
                        ? new BigDecimal(node.get("filled_avg_price").asText()) : BigDecimal.ZERO,
                node.has("filled_qty") && !node.get("filled_qty").isNull()
                        ? new BigDecimal(node.get("filled_qty").asText()) : BigDecimal.ZERO,
                null,
                node.has("filled_at") && !node.get("filled_at").isNull()
                        ? LocalDateTime.parse(node.get("filled_at").asText().substring(0, 19)) : null
        );
    }

    // ──────────────────────────────── HTTP helpers ──────────────────────────────

    private HttpResponse<String> sendGet(String path) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .header("APCA-API-KEY-ID", apiKey)
                .header("APCA-API-SECRET-KEY", secretKey)
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        checkStatus(response);
        return response;
    }

    private HttpResponse<String> sendPost(String path, String jsonBody) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .header("APCA-API-KEY-ID", apiKey)
                .header("APCA-API-SECRET-KEY", secretKey)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        checkStatus(response);
        return response;
    }

    private void checkStatus(HttpResponse<String> response) throws IOException {
        if (response.statusCode() >= 400) {
            throw new IOException("Alpaca API error " + response.statusCode() + ": " + response.body());
        }
    }

    // ──────────────────────────────── Mapping helpers ───────────────────────────

    /**
     * Builds the JSON body for the Alpaca POST /v2/orders endpoint.
     */
    private Map<String, Object> buildOrderBody(OrderRequest req) {
        Map<String, Object> body = new HashMap<>();
        body.put("symbol", req.symbol());
        body.put("side", req.side());
        body.put("type", req.type());
        body.put("time_in_force", req.timeInForce() != null ? req.timeInForce() : "day");

        if (req.qty() != null) {
            body.put("qty", req.qty().toPlainString());
        }
        if (req.notional() != null) {
            body.put("notional", req.notional().toPlainString());
        }
        if (req.price() != null) {
            body.put("limit_price", req.price().toPlainString());
        }
        if (req.stopPrice() != null) {
            body.put("stop_price", req.stopPrice().toPlainString());
        }

        return body;
    }

    /**
     * Maps Alpaca order status strings to the standardized FinSentinel status values.
     *
     * <ul>
     *   <li>{@code filled} -> {@code filled}</li>
     *   <li>{@code canceled} -> {@code cancelled}</li>
     *   <li>{@code rejected}, {@code expired} -> {@code rejected}</li>
     *   <li>everything else -> {@code pending}</li>
     * </ul>
     */
    private String mapOrderStatus(String alpacaStatus) {
        return switch (alpacaStatus) {
            case "filled" -> "filled";
            case "canceled" -> "cancelled";
            case "rejected", "expired" -> "rejected";
            default -> "pending";
        };
    }
}
