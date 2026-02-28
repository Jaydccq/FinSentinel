package com.example.finsentinel.dto.trading;

import com.example.finsentinel.model.enums.TradingMode;
import jakarta.validation.constraints.NotNull;

/**
 * Request body for switching the trading mode (PAPER or LIVE).
 *
 * @param mode the desired trading mode
 */
public record SwitchModeRequest(
        @NotNull(message = "Trading mode is required")
        TradingMode mode
) {}
