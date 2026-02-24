package com.example.finsentinel.service.trading.engine;

import lombok.extern.slf4j.Slf4j;
import org.knowm.xchange.Exchange;
import org.knowm.xchange.ExchangeFactory;
import org.knowm.xchange.ExchangeSpecification;
import org.knowm.xchange.binance.BinanceExchange;
import org.knowm.xchange.currency.Currency;
import org.knowm.xchange.currency.CurrencyPair;
import org.knowm.xchange.dto.Order.OrderType;
import org.knowm.xchange.dto.account.AccountInfo;
import org.knowm.xchange.dto.account.Balance;
import org.knowm.xchange.dto.account.Wallet;
import org.knowm.xchange.dto.trade.LimitOrder;
import org.knowm.xchange.dto.trade.MarketOrder;
import org.knowm.xchange.dto.trade.OpenOrders;
import org.knowm.xchange.service.account.AccountService;
import org.knowm.xchange.service.trade.TradeService;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Crypto exchange trading engine using XChange library (Java CCXT equivalent).
 * Supports any exchange that XChange supports, with Binance as the default.
 * NOT a Spring bean -- instantiated by TradingEngineFactory per wallet.
 */
@Slf4j
public class CcxtTradingEngine implements TradingEngine {

    private final String exchangeName;
    private final Exchange exchange;

    public CcxtTradingEngine(String exchangeName, String apiKey, String secretKey, boolean sandbox) {
        this.exchangeName = exchangeName != null ? exchangeName.toLowerCase() : "binance";
        Exchange created = null;

        if (apiKey != null && secretKey != null) {
            try {
                ExchangeSpecification spec = new BinanceExchange().getDefaultExchangeSpecification();
                spec.setApiKey(apiKey);
                spec.setSecretKey(secretKey);
                if (sandbox) {
                    spec.setExchangeSpecificParametersItem("Use_Sandbox", true);
                }
                created = ExchangeFactory.INSTANCE.createExchange(spec);
                log.info("CcxtTradingEngine initialized for exchange={} sandbox={}", this.exchangeName, sandbox);
            } catch (Exception e) {
                log.warn("Failed to initialize CcxtTradingEngine for exchange={}: {}", this.exchangeName, e.getMessage());
            }
        } else {
            log.warn("CcxtTradingEngine created without API keys for exchange={} -- all operations will return safe defaults",
                    this.exchangeName);
        }

        this.exchange = created;
    }

    @Override
    public OrderResult placeOrder(OrderRequest request) {
        if (exchange == null) {
            return errorResult("Exchange not initialized");
        }
        try {
            TradeService tradeService = exchange.getTradeService();
            CurrencyPair pair = parsePair(request.symbol());
            OrderType orderType = "buy".equalsIgnoreCase(request.side()) ? OrderType.BID : OrderType.ASK;
            BigDecimal qty = request.qty() != null ? request.qty() : BigDecimal.ZERO;

            String orderId;

            if ("limit".equalsIgnoreCase(request.type())) {
                BigDecimal price = request.price() != null ? request.price() : BigDecimal.ZERO;
                LimitOrder limitOrder = new LimitOrder.Builder(orderType, pair)
                        .originalAmount(qty)
                        .limitPrice(price)
                        .build();
                orderId = tradeService.placeLimitOrder(limitOrder);
            } else {
                // Default to market order
                MarketOrder marketOrder = new MarketOrder.Builder(orderType, pair)
                        .originalAmount(qty)
                        .build();
                orderId = tradeService.placeMarketOrder(marketOrder);
            }

            log.info("Placed {} {} order for {} qty={} orderId={}", request.type(), request.side(),
                    request.symbol(), qty, orderId);

            return new OrderResult(true, orderId, "pending", null, qty, null, LocalDateTime.now());

        } catch (Exception e) {
            log.error("Failed to place order for {}: {}", request.symbol(), e.getMessage(), e);
            return errorResult(e.getMessage());
        }
    }

    @Override
    public List<PositionInfo> getPositions() {
        if (exchange == null) {
            return List.of();
        }
        try {
            AccountService accountService = exchange.getAccountService();
            AccountInfo accountInfo = accountService.getAccountInfo();

            List<PositionInfo> positions = new ArrayList<>();

            for (Wallet wallet : accountInfo.getWallets().values()) {
                Collection<Balance> balances = wallet.getBalances().values();
                for (Balance balance : balances) {
                    String code = balance.getCurrency().getCurrencyCode();
                    // Skip stablecoin / fiat balances
                    if ("USD".equalsIgnoreCase(code) || "USDT".equalsIgnoreCase(code)
                            || "USDC".equalsIgnoreCase(code)) {
                        continue;
                    }
                    BigDecimal available = balance.getAvailable();
                    if (available != null && available.compareTo(BigDecimal.ZERO) > 0) {
                        positions.add(new PositionInfo(
                                code + "/USD",
                                "long",
                                available,
                                BigDecimal.ZERO,   // avg entry not available from balance API
                                BigDecimal.ZERO,   // current price not available from balance API
                                BigDecimal.ZERO,
                                BigDecimal.ZERO,
                                BigDecimal.ZERO
                        ));
                    }
                }
            }

            return positions;

        } catch (Exception e) {
            log.error("Failed to get positions: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public List<OrderResult> getOrders() {
        if (exchange == null) {
            return List.of();
        }
        try {
            TradeService tradeService = exchange.getTradeService();
            OpenOrders openOrders = tradeService.getOpenOrders();

            return openOrders.getOpenOrders().stream()
                    .map(order -> new OrderResult(
                            true,
                            order.getId(),
                            order.getStatus() != null ? order.getStatus().toString().toLowerCase() : "pending",
                            order.getAveragePrice(),
                            order.getCumulativeAmount(),
                            null,
                            order.getTimestamp() != null
                                    ? order.getTimestamp().toInstant()
                                        .atZone(java.time.ZoneId.systemDefault())
                                        .toLocalDateTime()
                                    : null
                    ))
                    .toList();

        } catch (Exception e) {
            log.error("Failed to get open orders: {}", e.getMessage(), e);
            return List.of();
        }
    }

    @Override
    public com.example.finsentinel.service.trading.engine.AccountInfo getAccount() {
        if (exchange == null) {
            return new com.example.finsentinel.service.trading.engine.AccountInfo(
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO
            );
        }
        try {
            AccountService accountService = exchange.getAccountService();
            AccountInfo accountInfo = accountService.getAccountInfo();

            BigDecimal usdBalance = BigDecimal.ZERO;

            for (Wallet wallet : accountInfo.getWallets().values()) {
                // Try USD first, then USDT
                Balance usd = wallet.getBalance(Currency.USD);
                if (usd != null && usd.getAvailable().compareTo(BigDecimal.ZERO) > 0) {
                    usdBalance = usdBalance.add(usd.getAvailable());
                }
                Balance usdt = wallet.getBalance(new Currency("USDT"));
                if (usdt != null && usdt.getAvailable().compareTo(BigDecimal.ZERO) > 0) {
                    usdBalance = usdBalance.add(usdt.getAvailable());
                }
            }

            return new com.example.finsentinel.service.trading.engine.AccountInfo(
                    usdBalance,        // cash
                    usdBalance,        // portfolioValue (simplified)
                    usdBalance,        // equity
                    usdBalance,        // buyingPower
                    BigDecimal.ZERO,   // unrealizedPnL
                    BigDecimal.ZERO    // realizedPnL
            );

        } catch (Exception e) {
            log.error("Failed to get account info: {}", e.getMessage(), e);
            return new com.example.finsentinel.service.trading.engine.AccountInfo(
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO,
                    BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO
            );
        }
    }

    @Override
    public boolean cancelOrder(String orderId) {
        if (exchange == null) {
            return false;
        }
        try {
            TradeService tradeService = exchange.getTradeService();
            tradeService.cancelOrder(orderId);
            log.info("Cancelled order {}", orderId);
            return true;
        } catch (Exception e) {
            log.error("Failed to cancel order {}: {}", orderId, e.getMessage(), e);
            return false;
        }
    }

    @Override
    public String engineName() {
        return "crypto-" + exchangeName;
    }

    // ---- helpers ----

    /**
     * Parse a symbol like "BTC/USD" into a CurrencyPair.
     * Falls back to base/USD if no separator found.
     */
    CurrencyPair parsePair(String symbol) {
        if (symbol == null || symbol.isBlank()) {
            return new CurrencyPair("BTC", "USD");
        }
        String[] parts = symbol.split("/");
        if (parts.length == 2) {
            return new CurrencyPair(parts[0].trim().toUpperCase(), parts[1].trim().toUpperCase());
        }
        return new CurrencyPair(symbol.trim().toUpperCase(), "USD");
    }

    private OrderResult errorResult(String error) {
        return new OrderResult(false, null, "rejected", null, null, error, null);
    }
}
