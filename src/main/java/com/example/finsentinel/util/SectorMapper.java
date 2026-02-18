package com.example.finsentinel.util;

public final class SectorMapper {

    private SectorMapper() {}

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
