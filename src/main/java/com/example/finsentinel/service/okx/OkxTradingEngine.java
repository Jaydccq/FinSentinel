package com.example.finsentinel.service.okx;

import com.example.finsentinel.service.okx.dto.*;
import com.example.finsentinel.service.trading.engine.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * OKX v5 implementation of {@link TradingEngine}.
 *
 * <p>NOT a Spring bean — instantiated by {@link com.example.finsentinel.service.trading.engine.TradingEngineFactory}
 * when OKX is enabled. Delegates all HTTP calls to {@link OkxApiClient}.
 *
 * <p>Supports spot, perpetual swap (SWAP), and futures instruments. Futures are
 * auto-detected by suffix ({@code -SWAP}, {@code -FUTURES}) and use cross-margin
 * trade mode instead of cash.
 *
 * <p>All exceptions are caught and logged — methods return safe defaults (empty
 * lists, zero-valued accounts, failed order results) so callers never see exceptions.
 */
@Slf4j
@RequiredArgsConstructor
public class OkxTradingEngine implements TradingEngine {

    private final OkxApiClient okxApiClient;

    // ── TradingEngine interface ─────────────────────────────────────────

    @Override
    public String engineName() {
        return "crypto-okx";
    }

    @Override
    public MarketClock getMarketClock() {
        // Crypto markets are always open (24/7/365)
        return new MarketClock(true, null, null, Instant.now());
    }

    @Override
    public OrderResult placeOrder(OrderRequest request) {
        try {
            Map<String, Object> body = buildOrderBody(request);

            OkxResponse<OkxOrder> response = okxApiClient.placeOrder(body);

            if (!response.isSuccess() || response.data().isEmpty()) {
                String error = response.msg() != null ? response.msg() : "Unknown OKX error";
                log.warn("OKX placeOrder failed: code={} msg={}", response.code(), error);
                return errorResult(error);
            }

            OkxOrder order = response.data().getFirst();
            log.info("OKX order placed: ordId={} instId={} side={} sz={}",
                    order.ordId(), request.symbol(), request.side(), request.qty());

            return mapOrder(order);
        } catch (Exception e) {
            log.error("OKX placeOrder exception for {}: {}", request.symbol(), e.getMessage(), e);
            return errorResult(e.getMessage());
        }
    }

    @Override
    public List<PositionInfo> getPositions() {
        try {
            OkxResponse<OkxPosition> response = okxApiClient.getPositions();

            if (!response.isSuccess()) {
                log.warn("OKX getPositions failed: {}", response.msg());
                return List.of();
            }

            return response.data().stream()
                    .filter(p -> safeBigDecimal(p.pos()).compareTo(BigDecimal.ZERO) != 0)
                    .map(this::mapPosition)
                    .toList();
        } catch (Exception e) {
            log.error("OKX getPositions exception: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public List<OrderResult> getOrders() {
        try {
            OkxResponse<OkxOrder> response = okxApiClient.getPendingOrders();

            if (!response.isSuccess()) {
                log.warn("OKX getPendingOrders failed: {}", response.msg());
                return List.of();
            }

            return response.data().stream()
                    .map(this::mapOrder)
                    .toList();
        } catch (Exception e) {
            log.error("OKX getOrders exception: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public AccountInfo getAccount() {
        try {
            OkxResponse<OkxAccountBalance> response = okxApiClient.getBalance();

            if (!response.isSuccess() || response.data().isEmpty()) {
                log.warn("OKX getBalance failed: {}", response.msg());
                return zeroAccount();
            }

            OkxAccountBalance balance = response.data().getFirst();
            return mapAccount(balance);
        } catch (Exception e) {
            log.error("OKX getAccount exception: {}", e.getMessage(), e);
            return zeroAccount();
        }
    }

    @Override
    public boolean cancelOrder(String orderId) {
        try {
            // OKX requires instId + ordId to cancel. Find the order's instId first.
            OkxResponse<OkxOrder> pendingResponse = okxApiClient.getPendingOrders();

            if (!pendingResponse.isSuccess()) {
                log.warn("OKX cancelOrder: failed to fetch pending orders: {}", pendingResponse.msg());
                return false;
            }

            String instId = pendingResponse.data().stream()
                    .filter(o -> orderId.equals(o.ordId()))
                    .map(OkxOrder::instId)
                    .findFirst()
                    .orElse(null);

            if (instId == null) {
                log.warn("OKX cancelOrder: order {} not found in pending orders", orderId);
                return false;
            }

            OkxResponse<OkxOrder> cancelResponse = okxApiClient.cancelOrder(instId, orderId);

            if (!cancelResponse.isSuccess()) {
                log.warn("OKX cancelOrder failed for ordId={}: {}", orderId, cancelResponse.msg());
                return false;
            }

            log.info("OKX order cancelled: ordId={} instId={}", orderId, instId);
            return true;
        } catch (Exception e) {
            log.error("OKX cancelOrder exception for ordId={}: {}", orderId, e.getMessage(), e);
            return false;
        }
    }

    // ── OKX-specific methods (not in TradingEngine interface) ───────────

    /**
     * Get funding rate for a perpetual swap instrument.
     *
     * @param instId instrument ID (e.g. "BTC-USDT-SWAP")
     * @return the funding rate, or {@code null} if unavailable
     */
    public OkxFundingRate getFundingRate(String instId) {
        try {
            OkxResponse<OkxFundingRate> response = okxApiClient.getFundingRate(instId);
            if (response.isSuccess() && !response.data().isEmpty()) {
                return response.data().getFirst();
            }
            return null;
        } catch (Exception e) {
            log.error("OKX getFundingRate exception for {}: {}", instId, e.getMessage());
            return null;
        }
    }

    /**
     * Get per-currency balance details.
     *
     * @return list of balance details, or empty list on error
     */
    public List<OkxAccountBalance.BalanceDetail> getBalanceDetails() {
        try {
            OkxResponse<OkxAccountBalance> response = okxApiClient.getBalance();
            if (response.isSuccess() && !response.data().isEmpty()) {
                List<OkxAccountBalance.BalanceDetail> details = response.data().getFirst().details();
                return details != null ? details : List.of();
            }
            return List.of();
        } catch (Exception e) {
            log.error("OKX getBalanceDetails exception: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * Get order history for an instrument type.
     *
     * @param instType instrument type (e.g. "SPOT", "SWAP", "FUTURES")
     * @return list of historical orders, or empty list on error
     */
    public List<OkxOrder> getOrderHistory(String instType) {
        try {
            OkxResponse<OkxOrder> response = okxApiClient.getOrderHistory(instType);
            if (response.isSuccess()) {
                return response.data();
            }
            return List.of();
        } catch (Exception e) {
            log.error("OKX getOrderHistory exception for {}: {}", instType, e.getMessage());
            return List.of();
        }
    }

    /**
     * Set leverage for an instrument.
     *
     * @param instId     instrument ID (e.g. "BTC-USDT-SWAP")
     * @param leverage   leverage multiplier (e.g. "10")
     * @param marginMode margin mode ("cross" or "isolated")
     * @return {@code true} if leverage was set successfully
     */
    public boolean setLeverage(String instId, String leverage, String marginMode) {
        try {
            var response = okxApiClient.setLeverage(instId, leverage, marginMode);
            if (response.isSuccess()) {
                log.info("OKX leverage set: instId={} lever={} mode={}", instId, leverage, marginMode);
                return true;
            }
            log.warn("OKX setLeverage failed: {}", response.msg());
            return false;
        } catch (Exception e) {
            log.error("OKX setLeverage exception for {}: {}", instId, e.getMessage());
            return false;
        }
    }

    // ── Mapping helpers ─────────────────────────────────────────────────

    /**
     * Build OKX order request body from the generic {@link OrderRequest}.
     */
    Map<String, Object> buildOrderBody(OrderRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("instId", request.symbol());
        body.put("side", request.side().toLowerCase());
        body.put("ordType", mapOrderType(request.type()));
        body.put("sz", request.qty() != null ? request.qty().toPlainString() : "0");

        // Auto-detect futures/swap → use cross margin; spot → cash
        boolean isFutures = request.symbol() != null
                && (request.symbol().contains("-SWAP") || request.symbol().contains("-FUTURES"));
        body.put("tdMode", isFutures ? "cross" : "cash");

        // Limit price
        if (request.price() != null && request.price().compareTo(BigDecimal.ZERO) > 0) {
            body.put("px", request.price().toPlainString());
        }

        // Reduce-only flag for futures
        if (request.reduceOnly()) {
            body.put("reduceOnly", true);
        }

        return body;
    }

    private PositionInfo mapPosition(OkxPosition p) {
        BigDecimal pos = safeBigDecimal(p.pos());
        BigDecimal avgPx = safeBigDecimal(p.avgPx());
        BigDecimal markPx = safeBigDecimal(p.markPx() != null ? p.markPx() : p.last());
        BigDecimal upl = safeBigDecimal(p.upl());

        String side = pos.compareTo(BigDecimal.ZERO) >= 0 ? "long" : "short";
        BigDecimal absPos = pos.abs();
        BigDecimal marketValue = absPos.multiply(markPx);
        BigDecimal costBasis = absPos.multiply(avgPx);

        return new PositionInfo(
                p.instId(),
                side,
                absPos,
                avgPx,
                markPx,
                marketValue,
                upl,
                costBasis
        );
    }

    private OrderResult mapOrder(OkxOrder order) {
        String status = mapOrderStatus(order.state());
        BigDecimal filledPrice = safeBigDecimal(order.avgPx());
        BigDecimal filledQty = safeBigDecimal(order.accFillSz());

        LocalDateTime filledAt = null;
        if (order.uTime() != null && !order.uTime().isBlank()) {
            try {
                long ts = Long.parseLong(order.uTime());
                filledAt = LocalDateTime.ofInstant(Instant.ofEpochMilli(ts), ZoneOffset.UTC);
            } catch (NumberFormatException ignored) {
                // OKX timestamps are epoch millis; ignore if unparseable
            }
        }

        boolean success = !"rejected".equals(status);

        return new OrderResult(
                success,
                order.ordId(),
                status,
                filledPrice,
                filledQty,
                null,
                filledAt
        );
    }

    private AccountInfo mapAccount(OkxAccountBalance balance) {
        BigDecimal equity = safeBigDecimal(balance.totalEq());
        BigDecimal imr = safeBigDecimal(balance.imr());
        BigDecimal available = equity.subtract(imr);

        // Sum unrealized PnL from balance details
        BigDecimal unrealizedPnL = BigDecimal.ZERO;
        if (balance.details() != null) {
            for (OkxAccountBalance.BalanceDetail detail : balance.details()) {
                unrealizedPnL = unrealizedPnL.add(safeBigDecimal(detail.upl()));
            }
        }

        return new AccountInfo(
                available,       // cash (available after margin)
                equity,          // portfolioValue
                equity,          // equity
                available,       // buyingPower (equity - IMR)
                unrealizedPnL,   // unrealizedPnL
                BigDecimal.ZERO  // realizedPnL (not available from balance endpoint)
        );
    }

    // ── Utility helpers ─────────────────────────────────────────────────

    /**
     * Safely parse a string to {@link BigDecimal}, returning {@link BigDecimal#ZERO}
     * on null, empty, or unparseable input.
     */
    static BigDecimal safeBigDecimal(String value) {
        if (value == null || value.isBlank()) {
            return BigDecimal.ZERO;
        }
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    /**
     * Map generic order type to OKX order type string.
     */
    private String mapOrderType(String type) {
        if (type == null) return "market";
        return switch (type.toLowerCase()) {
            case "limit" -> "limit";
            case "stop", "stop_limit" -> "trigger";
            default -> "market";
        };
    }

    /**
     * Map OKX order state to generic status string.
     */
    private String mapOrderStatus(String okxState) {
        if (okxState == null) return "pending";
        return switch (okxState.toLowerCase()) {
            case "filled" -> "filled";
            case "canceled", "cancelled" -> "cancelled";
            case "live", "partially_filled" -> "pending";
            default -> "pending";
        };
    }

    private OrderResult errorResult(String error) {
        return new OrderResult(false, null, "rejected", null, null, error, null);
    }

    private AccountInfo zeroAccount() {
        return new AccountInfo(
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO
        );
    }
}
