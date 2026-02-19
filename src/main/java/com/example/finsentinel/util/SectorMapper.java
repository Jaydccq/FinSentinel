package com.example.finsentinel.util;

/**
 * Provides utility functions for sector mapper operations.
 *
 * <p>This class is part of the util layer in FinSentinel.
 */

public final class SectorMapper {

    /**
     * Creates a new SectorMapper instance.
     *
     * <p>This method is defined in {@link SectorMapper}.
     */

    private SectorMapper() {}

    /**
     * Executes from ticker.
     *
     * <p>This method belongs to {@link SectorMapper} and encapsulates the
     * from ticker workflow.
     * @param ticker ticker (String)
     * @return the from ticker result (String)
     */

    public static String fromTicker(String ticker) {
        if (ticker == null) return null;
        return switch (ticker.toUpperCase()) {
            case "AAPL", "MSFT", "GOOGL", "GOOG", "META", "NVDA", "AMD", "INTC" -> "Technology";
            case "JPM", "BAC", "GS", "MS", "WFC", "C" -> "Financial";
            case "JNJ", "PFE", "UNH", "ABBV", "MRK" -> "Healthcare";
            case "TSLA", "F", "GM" -> "Automotive";
            case "AMZN", "WMT", "TGT", "COST" -> "Retail";
            case "XOM", "CVX", "COP" -> "Energy";
            default -> null;
        };
    }
}
