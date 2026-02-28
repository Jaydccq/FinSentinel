package com.example.finsentinel.dto.trading;

import java.time.Instant;

/**
 * Response representing the current market clock status.
 *
 * @param isOpen    whether the market is currently open
 * @param nextOpen  the next market open time (null if currently open)
 * @param nextClose the next market close time (null if currently closed)
 * @param timestamp the time this status was checked
 */
public record MarketHoursResponse(
        boolean isOpen,
        Instant nextOpen,
        Instant nextClose,
        Instant timestamp
) {}
