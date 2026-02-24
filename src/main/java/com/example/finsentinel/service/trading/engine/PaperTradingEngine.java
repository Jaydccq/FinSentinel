package com.example.finsentinel.service.trading.engine;

import com.example.finsentinel.service.MarketDataService;
import lombok.extern.slf4j.Slf4j;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Simulated paper trading engine for risk-free strategy testing.
 *
 * <p>This engine is NOT a Spring bean -- it is created per-user by the
 * {@code TradingEngineFactory}. All orders fill immediately at the current
 * market price fetched from {@link MarketDataService}.
 *
 * <p>Positions are tracked in-memory as maps (ticker, shares, avgCost) so
 * they can be serialized directly into the wallet's JSONB column for persistence
 * across sessions.
 */
@Slf4j
public class PaperTradingEngine implements TradingEngine {

    private final MarketDataService marketDataService;

    private BigDecimal cash;
    private final BigDecimal initialCash;
    private BigDecimal realizedPnL = BigDecimal.ZERO;

    /** Position maps: each contains { ticker, shares, avgCost, currentPrice }. */
    private final List<Map<String, Object>> positions = new CopyOnWriteArrayList<>();

    /** Completed order history (paper fills are immediate, so all are filled). */
    private final List<OrderResult> orderHistory = new ArrayList<>();

    private int orderSequence = 0;

    public PaperTradingEngine(MarketDataService marketDataService, BigDecimal initialCash) {
        this.marketDataService = Objects.requireNonNull(marketDataService, "marketDataService must not be null");
        this.initialCash = Objects.requireNonNull(initialCash, "initialCash must not be null");
        this.cash = initialCash;
    }

    // ─────────────────────────── TradingEngine contract ─────────────────────

    @Override
    public OrderResult placeOrder(OrderRequest request) {
        String symbol = request.symbol().toUpperCase().trim();
        String side = request.side().toLowerCase().trim();

        return switch (side) {
            case "buy" -> executeBuy(symbol, request);
            case "sell" -> executeSell(symbol, request);
            default -> {
                OrderResult rejected = new OrderResult(
                        false, nextOrderId(), "rejected",
                        null, null,
                        "Unknown side: " + side + ". Use 'buy' or 'sell'.",
                        LocalDateTime.now());
                orderHistory.add(rejected);
                yield rejected;
            }
        };
    }

    @Override
    public List<PositionInfo> getPositions() {
        List<PositionInfo> infos = new ArrayList<>();
        for (Map<String, Object> pos : positions) {
            String ticker = (String) pos.get("ticker");
            BigDecimal shares = toBigDecimal(pos.get("shares"));
            BigDecimal avgCost = toBigDecimal(pos.get("avgCost"));

            BigDecimal currentPrice;
            try {
                currentPrice = fetchCurrentPrice(ticker);
                pos.put("currentPrice", currentPrice);
            } catch (Exception e) {
                currentPrice = pos.containsKey("currentPrice")
                        ? toBigDecimal(pos.get("currentPrice"))
                        : avgCost;
                log.warn("Could not fetch price for {}, using last known: {}", ticker, currentPrice);
            }

            BigDecimal marketValue = shares.multiply(currentPrice).setScale(2, RoundingMode.HALF_UP);
            BigDecimal costBasis = shares.multiply(avgCost).setScale(2, RoundingMode.HALF_UP);
            BigDecimal unrealizedPnL = marketValue.subtract(costBasis);

            infos.add(new PositionInfo(
                    ticker, "long", shares, avgCost,
                    currentPrice, marketValue, unrealizedPnL, costBasis));
        }
        return infos;
    }

    @Override
    public List<OrderResult> getOrders() {
        return Collections.unmodifiableList(orderHistory);
    }

    @Override
    public AccountInfo getAccount() {
        BigDecimal portfolioValue = BigDecimal.ZERO;
        BigDecimal totalUnrealizedPnL = BigDecimal.ZERO;

        for (Map<String, Object> pos : positions) {
            String ticker = (String) pos.get("ticker");
            BigDecimal shares = toBigDecimal(pos.get("shares"));
            BigDecimal avgCost = toBigDecimal(pos.get("avgCost"));

            BigDecimal currentPrice;
            try {
                currentPrice = fetchCurrentPrice(ticker);
                pos.put("currentPrice", currentPrice);
            } catch (Exception e) {
                currentPrice = pos.containsKey("currentPrice")
                        ? toBigDecimal(pos.get("currentPrice"))
                        : avgCost;
            }

            BigDecimal marketValue = shares.multiply(currentPrice).setScale(2, RoundingMode.HALF_UP);
            BigDecimal costBasis = shares.multiply(avgCost).setScale(2, RoundingMode.HALF_UP);
            portfolioValue = portfolioValue.add(marketValue);
            totalUnrealizedPnL = totalUnrealizedPnL.add(marketValue.subtract(costBasis));
        }

        BigDecimal equity = cash.add(portfolioValue);

        return new AccountInfo(
                cash,
                portfolioValue,
                equity,
                cash,               // buying power = cash (no margin in paper)
                totalUnrealizedPnL,
                realizedPnL);
    }

    /**
     * Paper orders fill immediately -- there is nothing to cancel.
     *
     * @param orderId ignored
     * @return always {@code false}
     */
    @Override
    public boolean cancelOrder(String orderId) {
        return false;
    }

    @Override
    public String engineName() {
        return "paper";
    }

    // ─────────────────────── Sync helpers (wallet restore) ─────────────────

    /** Restore cash balance from the persisted wallet. */
    public void setCash(BigDecimal cash) {
        this.cash = Objects.requireNonNull(cash, "cash must not be null");
    }

    /** Current cash balance. */
    public BigDecimal getCash() {
        return cash;
    }

    /**
     * Restore positions from the wallet's JSONB positions column.
     *
     * <p>Each map is expected to contain at minimum: {@code ticker}, {@code shares},
     * {@code avgCost}. Optionally: {@code currentPrice}.
     *
     * @param positionMaps list of position maps from the wallet entity
     */
    public void setPositions(List<Map<String, Object>> positionMaps) {
        positions.clear();
        if (positionMaps != null) {
            for (Map<String, Object> src : positionMaps) {
                // Deep-copy so the engine owns mutable copies
                positions.add(new LinkedHashMap<>(src));
            }
        }
    }

    /**
     * Export current positions as maps suitable for wallet JSONB persistence.
     *
     * @return deep-copied list of position maps
     */
    public List<Map<String, Object>> getPositionMaps() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> pos : positions) {
            result.add(new LinkedHashMap<>(pos));
        }
        return result;
    }

    // ─────────────────────────── Internal ───────────────────────────────────

    private OrderResult executeBuy(String symbol, OrderRequest request) {
        BigDecimal currentPrice = fetchCurrentPrice(symbol);
        BigDecimal qty = resolveQty(request, currentPrice);
        BigDecimal cost = qty.multiply(currentPrice).setScale(2, RoundingMode.HALF_UP);

        if (cost.compareTo(cash) > 0) {
            OrderResult rejected = new OrderResult(
                    false, nextOrderId(), "rejected",
                    currentPrice, qty,
                    String.format("Insufficient funds. Need $%s but only have $%s",
                            cost.toPlainString(), cash.toPlainString()),
                    LocalDateTime.now());
            orderHistory.add(rejected);
            log.info("Paper BUY rejected for {}: insufficient funds (need={}, have={})",
                    symbol, cost, cash);
            return rejected;
        }

        cash = cash.subtract(cost);
        addOrUpdatePosition(symbol, qty, currentPrice);

        OrderResult filled = new OrderResult(
                true, nextOrderId(), "filled",
                currentPrice, qty, null, LocalDateTime.now());
        orderHistory.add(filled);
        log.info("Paper BUY filled: {} x {} @ ${} (cost=${})", symbol, qty, currentPrice, cost);
        return filled;
    }

    private OrderResult executeSell(String symbol, OrderRequest request) {
        BigDecimal currentPrice = fetchCurrentPrice(symbol);
        Map<String, Object> position = findPosition(symbol);

        if (position == null) {
            OrderResult rejected = new OrderResult(
                    false, nextOrderId(), "rejected",
                    currentPrice, null,
                    "No position in " + symbol,
                    LocalDateTime.now());
            orderHistory.add(rejected);
            return rejected;
        }

        BigDecimal heldShares = toBigDecimal(position.get("shares"));
        BigDecimal qty;

        // If qty is null, sell all shares
        if (request.qty() == null && request.notional() == null) {
            qty = heldShares;
        } else {
            qty = resolveQty(request, currentPrice);
        }

        if (qty.compareTo(heldShares) > 0) {
            OrderResult rejected = new OrderResult(
                    false, nextOrderId(), "rejected",
                    currentPrice, qty,
                    String.format("Insufficient shares. Have %s but tried to sell %s",
                            heldShares.toPlainString(), qty.toPlainString()),
                    LocalDateTime.now());
            orderHistory.add(rejected);
            return rejected;
        }

        BigDecimal proceeds = qty.multiply(currentPrice).setScale(2, RoundingMode.HALF_UP);
        cash = cash.add(proceeds);

        // Calculate realized P&L for the sold portion
        BigDecimal avgCost = toBigDecimal(position.get("avgCost"));
        BigDecimal costBasisSold = qty.multiply(avgCost).setScale(2, RoundingMode.HALF_UP);
        realizedPnL = realizedPnL.add(proceeds.subtract(costBasisSold));

        reducePosition(symbol, qty, currentPrice);

        OrderResult filled = new OrderResult(
                true, nextOrderId(), "filled",
                currentPrice, qty, null, LocalDateTime.now());
        orderHistory.add(filled);
        log.info("Paper SELL filled: {} x {} @ ${} (proceeds=${})", symbol, qty, currentPrice, proceeds);
        return filled;
    }

    /**
     * Resolves the number of shares from either {@code qty} or {@code notional}.
     *
     * @param request      the order request
     * @param currentPrice the current market price
     * @return resolved quantity
     */
    private BigDecimal resolveQty(OrderRequest request, BigDecimal currentPrice) {
        if (request.qty() != null && request.qty().compareTo(BigDecimal.ZERO) > 0) {
            return request.qty();
        }
        if (request.notional() != null && request.notional().compareTo(BigDecimal.ZERO) > 0) {
            return request.notional().divide(currentPrice, 6, RoundingMode.HALF_DOWN);
        }
        throw new IllegalArgumentException("Order must specify either qty or notional");
    }

    private BigDecimal fetchCurrentPrice(String ticker) {
        Map<String, Object> quote = marketDataService.getQuote(ticker);
        Object closePrice = quote.get("close");
        if (closePrice == null) {
            throw new IllegalStateException("No price data available for " + ticker);
        }
        return toBigDecimal(closePrice);
    }

    private void addOrUpdatePosition(String ticker, BigDecimal newShares, BigDecimal price) {
        Map<String, Object> existing = findPosition(ticker);
        if (existing != null) {
            BigDecimal oldShares = toBigDecimal(existing.get("shares"));
            BigDecimal oldAvgCost = toBigDecimal(existing.get("avgCost"));
            // Weighted average cost
            BigDecimal totalCost = oldShares.multiply(oldAvgCost).add(newShares.multiply(price));
            BigDecimal totalShares = oldShares.add(newShares);
            BigDecimal newAvgCost = totalCost.divide(totalShares, 2, RoundingMode.HALF_UP);

            existing.put("shares", totalShares);
            existing.put("avgCost", newAvgCost);
            existing.put("currentPrice", price);
        } else {
            Map<String, Object> position = new LinkedHashMap<>();
            position.put("ticker", ticker);
            position.put("shares", newShares);
            position.put("avgCost", price);
            position.put("currentPrice", price);
            positions.add(position);
        }
    }

    private void reducePosition(String ticker, BigDecimal sharesToSell, BigDecimal currentPrice) {
        Map<String, Object> position = findPosition(ticker);
        if (position == null) return;

        BigDecimal remaining = toBigDecimal(position.get("shares")).subtract(sharesToSell);
        if (remaining.compareTo(BigDecimal.ZERO) <= 0) {
            positions.removeIf(p -> ticker.equalsIgnoreCase((String) p.get("ticker")));
        } else {
            position.put("shares", remaining);
            position.put("currentPrice", currentPrice);
        }
    }

    private Map<String, Object> findPosition(String ticker) {
        return positions.stream()
                .filter(p -> ticker.equalsIgnoreCase((String) p.get("ticker")))
                .findFirst()
                .orElse(null);
    }

    private String nextOrderId() {
        return "paper-" + (++orderSequence);
    }

    private BigDecimal toBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        if (value instanceof BigDecimal bd) return bd;
        if (value instanceof Number n) return new BigDecimal(n.toString());
        return new BigDecimal(value.toString());
    }
}
