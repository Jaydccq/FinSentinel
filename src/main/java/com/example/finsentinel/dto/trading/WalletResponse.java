package com.example.finsentinel.dto.trading;

import com.example.finsentinel.model.enums.TradingMode;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Response representing the current wallet state.
 *
 * @param initialCapital the starting capital
 * @param cashBalance    current available cash
 * @param positions      list of open positions (each as a map with ticker, shares, avgCost, currentPrice)
 * @param totalValue     total portfolio value (cash + positions)
 * @param returnPercent  overall return percentage
 * @param tradingMode    current trading mode (PAPER or LIVE)
 */
public record WalletResponse(
        BigDecimal initialCapital,
        BigDecimal cashBalance,
        List<Map<String, Object>> positions,
        BigDecimal totalValue,
        BigDecimal returnPercent,
        TradingMode tradingMode
) {}
