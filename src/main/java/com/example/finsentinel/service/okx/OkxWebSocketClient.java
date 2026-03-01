package com.example.finsentinel.service.okx;

import com.example.finsentinel.config.OkxProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * OKX v5 WebSocket client for real-time market data and private account updates.
 *
 * <p>Manages two WebSocket connections:
 * <ul>
 *   <li><b>Public</b> ({@code /ws/v5/public}) — subscribes to {@code tickers} channel
 *       for each instrument in {@link OkxProperties#getWatchPairs()}</li>
 *   <li><b>Private</b> ({@code /ws/v5/private}) — authenticates via HMAC-SHA256 login,
 *       then subscribes to {@code positions}, {@code orders}, and {@code account} channels</li>
 * </ul>
 *
 * <p><b>Connection management:</b>
 * <ul>
 *   <li>Auto-reconnect with exponential backoff (1s to 60s max)</li>
 *   <li>Ping every 25 seconds (OKX drops connections after 30s inactivity)</li>
 *   <li>Fragmented message buffering (accumulates partial frames)</li>
 * </ul>
 *
 * <p>Ticker updates are forwarded to {@link OkxPriceService}. Private channel events
 * (positions, orders, account) are logged at INFO level; downstream consumers can be
 * wired via {@link org.springframework.context.ApplicationEventPublisher} in future tasks.
 *
 * <p>Uses Java 21's {@link java.net.http.WebSocket} API — no external WebSocket library needed.
 */
@Service
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.trading.okx.websocket-enabled", havingValue = "true")
public class OkxWebSocketClient {

    private static final String HMAC_SHA256 = "HmacSHA256";
    private static final int PING_INTERVAL_SECONDS = 25;
    private static final int MAX_BACKOFF_SECONDS = 60;

    private final OkxProperties properties;
    private final OkxPriceService priceService;
    private final ObjectMapper objectMapper;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicReference<WebSocket> publicWs = new AtomicReference<>();
    private final AtomicReference<WebSocket> privateWs = new AtomicReference<>();

    private ScheduledExecutorService scheduler;
    private ExecutorService reconnectExecutor;

    // ── Lifecycle ────────────────────────────────────────────────────────

    @PostConstruct
    void start() {
        running.set(true);
        scheduler = Executors.newScheduledThreadPool(2, Thread.ofVirtual().name("okx-ws-ping-", 0).factory());
        reconnectExecutor = Executors.newVirtualThreadPerTaskExecutor();

        log.info("OKX WebSocket client starting — watchPairs={}", properties.getWatchPairs());

        reconnectExecutor.submit(() -> connectPublic(0));

        boolean hasCredentials = properties.getApiKey() != null
                && !properties.getApiKey().isBlank()
                && properties.getSecretKey() != null
                && !properties.getSecretKey().isBlank();

        if (hasCredentials) {
            reconnectExecutor.submit(() -> connectPrivate(0));
        } else {
            log.info("OKX WebSocket: skipping private channel (no API credentials configured)");
        }
    }

    @PreDestroy
    void stop() {
        log.info("OKX WebSocket client shutting down");
        running.set(false);

        closeQuietly(publicWs.getAndSet(null));
        closeQuietly(privateWs.getAndSet(null));

        if (scheduler != null) {
            scheduler.shutdownNow();
        }
        if (reconnectExecutor != null) {
            reconnectExecutor.shutdownNow();
        }
    }

    // ── Public WebSocket ─────────────────────────────────────────────────

    private void connectPublic(int attempt) {
        if (!running.get()) return;

        String url = properties.getWebsocketUrl() + "/public";
        log.info("Connecting to OKX public WebSocket: {} (attempt {})", url, attempt + 1);

        try {
            HttpClient client = HttpClient.newHttpClient();
            WebSocket ws = client.newWebSocketBuilder()
                    .buildAsync(URI.create(url), new PublicListener(attempt))
                    .join();
            publicWs.set(ws);
        } catch (Exception e) {
            log.error("OKX public WebSocket connection failed: {}", e.getMessage());
            scheduleReconnect(true, attempt);
        }
    }

    private void subscribePublicChannels(WebSocket ws) {
        for (String pair : properties.getWatchPairs()) {
            String msg = """
                    {"op":"subscribe","args":[{"channel":"tickers","instId":"%s"}]}""".formatted(pair);
            ws.sendText(msg, true);
            log.debug("Subscribed to tickers channel: {}", pair);
        }
    }

    // ── Private WebSocket ────────────────────────────────────────────────

    private void connectPrivate(int attempt) {
        if (!running.get()) return;

        String url = properties.getWebsocketUrl() + "/private";
        log.info("Connecting to OKX private WebSocket: {} (attempt {})", url, attempt + 1);

        try {
            HttpClient client = HttpClient.newHttpClient();
            WebSocket ws = client.newWebSocketBuilder()
                    .buildAsync(URI.create(url), new PrivateListener(attempt))
                    .join();
            privateWs.set(ws);
        } catch (Exception e) {
            log.error("OKX private WebSocket connection failed: {}", e.getMessage());
            scheduleReconnect(false, attempt);
        }
    }

    private void sendLoginMessage(WebSocket ws) {
        String timestamp = String.valueOf(Instant.now().getEpochSecond());
        String sign = signLogin(timestamp);

        String loginMsg = """
                {"op":"login","args":[{"apiKey":"%s","passphrase":"%s","timestamp":"%s","sign":"%s"}]}"""
                .formatted(properties.getApiKey(), properties.getPassphrase(), timestamp, sign);

        ws.sendText(loginMsg, true);
        log.debug("OKX private WebSocket: login message sent");
    }

    private void subscribePrivateChannels(WebSocket ws) {
        String msg = """
                {"op":"subscribe","args":[{"channel":"positions","instType":"ANY"},{"channel":"orders","instType":"ANY"},{"channel":"account"}]}""";
        ws.sendText(msg, true);
        log.debug("Subscribed to private channels: positions, orders, account");
    }

    /**
     * Sign for WebSocket login: Base64(HMAC-SHA256(timestamp + "GET" + "/users/self/verify", secretKey)).
     */
    private String signLogin(String timestamp) {
        try {
            String prehash = timestamp + "GET" + "/users/self/verify";
            Mac mac = Mac.getInstance(HMAC_SHA256);
            SecretKeySpec keySpec = new SecretKeySpec(
                    properties.getSecretKey().getBytes(StandardCharsets.UTF_8), HMAC_SHA256);
            mac.init(keySpec);
            byte[] hash = mac.doFinal(prehash.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to compute OKX WebSocket login signature", e);
        }
    }

    // ── Reconnection ─────────────────────────────────────────────────────

    private void scheduleReconnect(boolean isPublic, int attempt) {
        if (!running.get()) return;

        int delaySec = Math.min((int) Math.pow(2, attempt), MAX_BACKOFF_SECONDS);
        String label = isPublic ? "public" : "private";
        log.info("OKX {} WebSocket reconnecting in {}s (attempt {})", label, delaySec, attempt + 1);

        scheduler.schedule(() -> {
            if (isPublic) {
                connectPublic(attempt + 1);
            } else {
                connectPrivate(attempt + 1);
            }
        }, delaySec, TimeUnit.SECONDS);
    }

    // ── Ping keep-alive ──────────────────────────────────────────────────

    private void startPing(WebSocket ws, boolean isPublic) {
        String label = isPublic ? "public" : "private";
        scheduler.scheduleAtFixedRate(() -> {
            try {
                if (ws.isOutputClosed()) return;
                ws.sendText("ping", true);
                log.trace("OKX {} ping sent", label);
            } catch (Exception e) {
                log.debug("OKX {} ping failed: {}", label, e.getMessage());
            }
        }, PING_INTERVAL_SECONDS, PING_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    // ── Message handling ─────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private void handlePublicMessage(String text) {
        try {
            // OKX responds "pong" to our "ping"
            if ("pong".equals(text)) return;

            Map<String, Object> msg = objectMapper.readValue(text, new TypeReference<>() {});

            // Subscription confirmation
            if (msg.containsKey("event")) {
                String event = (String) msg.get("event");
                if ("subscribe".equals(event)) {
                    log.info("OKX public subscription confirmed: {}", msg.get("arg"));
                } else if ("error".equals(event)) {
                    log.warn("OKX public channel error: code={} msg={}", msg.get("code"), msg.get("msg"));
                }
                return;
            }

            // Ticker data push
            Object argObj = msg.get("arg");
            Object dataObj = msg.get("data");
            if (argObj instanceof Map<?, ?> arg && dataObj instanceof List<?> dataList) {
                String channel = (String) arg.get("channel");
                if ("tickers".equals(channel)) {
                    for (Object item : dataList) {
                        if (item instanceof Map<?, ?> rawItem) {
                            Map<String, String> data = (Map<String, String>) (Map<?, ?>) rawItem;
                            String instId = data.get("instId");
                            if (instId != null) {
                                priceService.updateTicker(instId, data);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("OKX public message parse error: {}", e.getMessage());
            log.debug("Raw message: {}", text);
        }
    }

    @SuppressWarnings("unchecked")
    private void handlePrivateMessage(String text) {
        try {
            if ("pong".equals(text)) return;

            Map<String, Object> msg = objectMapper.readValue(text, new TypeReference<>() {});

            // Login response
            if (msg.containsKey("event")) {
                String event = (String) msg.get("event");
                if ("login".equals(event)) {
                    log.info("OKX private WebSocket: login successful");
                    WebSocket ws = privateWs.get();
                    if (ws != null) {
                        subscribePrivateChannels(ws);
                    }
                    return;
                }
                if ("subscribe".equals(event)) {
                    log.info("OKX private subscription confirmed: {}", msg.get("arg"));
                    return;
                }
                if ("error".equals(event)) {
                    log.warn("OKX private channel error: code={} msg={}", msg.get("code"), msg.get("msg"));
                    return;
                }
            }

            // Data push from private channels
            Object argObj = msg.get("arg");
            Object dataObj = msg.get("data");
            if (argObj instanceof Map<?, ?> arg && dataObj instanceof List<?> dataList) {
                String channel = (String) arg.get("channel");
                switch (channel != null ? channel : "") {
                    case "positions" ->
                            log.info("OKX positions update: {} item(s)", dataList.size());
                    case "orders" ->
                            log.info("OKX orders update: {} item(s)", dataList.size());
                    case "account" ->
                            log.info("OKX account update: {} item(s)", dataList.size());
                    default ->
                            log.debug("OKX private push: channel={} items={}", channel, dataList.size());
                }
            }
        } catch (Exception e) {
            log.warn("OKX private message parse error: {}", e.getMessage());
            log.debug("Raw message: {}", text);
        }
    }

    // ── WebSocket Listeners ──────────────────────────────────────────────

    /**
     * Listener for the public WebSocket connection.
     *
     * <p>Handles fragmented frames by buffering partial text until the final
     * frame arrives ({@code last == true}), then delegates to
     * {@link #handlePublicMessage(String)}.
     */
    private class PublicListener implements WebSocket.Listener {

        private final StringBuilder buffer = new StringBuilder();
        private final AtomicInteger attempt;

        PublicListener(int attempt) {
            this.attempt = new AtomicInteger(attempt);
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            log.info("OKX public WebSocket connected");
            attempt.set(0);
            subscribePublicChannels(webSocket);
            startPing(webSocket, true);
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                String message = buffer.toString();
                buffer.setLength(0);
                handlePublicMessage(message);
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            log.warn("OKX public WebSocket closed: code={} reason={}", statusCode, reason);
            publicWs.set(null);
            scheduleReconnect(true, attempt.get());
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            log.error("OKX public WebSocket error: {}", error.getMessage());
            publicWs.set(null);
            scheduleReconnect(true, attempt.get());
        }
    }

    /**
     * Listener for the private WebSocket connection.
     *
     * <p>On open, sends the HMAC-SHA256 login message. After receiving login
     * confirmation, subscribes to private channels. Handles fragmented frames
     * the same way as {@link PublicListener}.
     */
    private class PrivateListener implements WebSocket.Listener {

        private final StringBuilder buffer = new StringBuilder();
        private final AtomicInteger attempt;

        PrivateListener(int attempt) {
            this.attempt = new AtomicInteger(attempt);
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            log.info("OKX private WebSocket connected — sending login");
            attempt.set(0);
            sendLoginMessage(webSocket);
            startPing(webSocket, false);
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                String message = buffer.toString();
                buffer.setLength(0);
                handlePrivateMessage(message);
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            log.warn("OKX private WebSocket closed: code={} reason={}", statusCode, reason);
            privateWs.set(null);
            scheduleReconnect(false, attempt.get());
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            log.error("OKX private WebSocket error: {}", error.getMessage());
            privateWs.set(null);
            scheduleReconnect(false, attempt.get());
        }
    }

    // ── Utility ──────────────────────────────────────────────────────────

    private void closeQuietly(WebSocket ws) {
        if (ws != null) {
            try {
                ws.sendClose(WebSocket.NORMAL_CLOSURE, "shutdown");
            } catch (Exception e) {
                log.debug("Error closing WebSocket: {}", e.getMessage());
            }
        }
    }
}
