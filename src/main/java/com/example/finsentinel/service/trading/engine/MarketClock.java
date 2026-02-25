package com.example.finsentinel.service.trading.engine;

import java.time.Instant;

public record MarketClock(
    boolean isOpen,
    Instant nextOpen,
    Instant nextClose,
    Instant timestamp
) {}
