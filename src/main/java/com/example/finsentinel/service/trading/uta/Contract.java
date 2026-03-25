package com.example.finsentinel.service.trading.uta;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * IBKR-inspired unified contract identifier for any tradable asset.
 * Immutable value object — two contracts are equal when all canonical fields match.
 */
public record Contract(
        String symbol,
        SecurityType secType,
        String exchange,
        String currency,
        LocalDate expiry,
        BigDecimal strike,
        String right,
        BigDecimal multiplier
) {

    private static final Pattern OKX_FUTURE_PATTERN = Pattern.compile("[A-Z]+-[A-Z]+-\\d{6}");
    private static final Pattern CRYPTO_PAIR_PATTERN = Pattern.compile("[A-Z]+/[A-Z]+");
    private static final Pattern CRYPTO_DASH_PATTERN = Pattern.compile("[A-Z]+-[A-Z]+");

    /** Major fiat currencies — if both sides of a dash/slash pair are fiat, it's FOREX, not CRYPTO. */
    private static final Set<String> FIAT_CURRENCIES = Set.of(
            "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
            "SEK", "NOK", "DKK", "SGD", "HKD", "CNY", "CNH",
            "KRW", "INR", "MXN", "BRL", "ZAR", "TRY", "PLN");

    public Contract {
        Objects.requireNonNull(symbol, "symbol must not be null");
        Objects.requireNonNull(secType, "secType must not be null");
        symbol = symbol.trim().toUpperCase();
        exchange = (exchange == null || exchange.isBlank()) ? "SMART" : exchange.trim().toUpperCase();
        currency = (currency == null || currency.isBlank()) ? "USD" : currency.trim().toUpperCase();
    }

    // ── Factory methods ──────────────────────────────────────────────────

    public static Contract stock(String symbol) {
        return new Contract(symbol, SecurityType.STOCK, "SMART", "USD", null, null, null, null);
    }

    public static Contract cryptoPerp(String symbol, String quoteCurrency, String exchange) {
        return new Contract(symbol, SecurityType.PERP, exchange, quoteCurrency, null, null, null, null);
    }

    public static Contract cryptoSpot(String symbol, String quoteCurrency, String exchange) {
        return new Contract(symbol, SecurityType.CRYPTO, exchange, quoteCurrency, null, null, null, null);
    }

    // ── Conversion methods ───────────────────────────────────────────────

    /**
     * Converts this contract to the native symbol format expected by the target engine.
     * <ul>
     *   <li>STOCK / OPTION / FUTURE / FOREX &rarr; plain symbol (e.g. "AAPL")</li>
     *   <li>PERP &rarr; OKX format "BTC-USDT-SWAP"</li>
     *   <li>CRYPTO &rarr; CCXT format "BTC/USD"</li>
     * </ul>
     */
    public String toEngineSymbol() {
        return switch (secType) {
            case PERP -> symbol + "-" + currency + "-SWAP";
            case CRYPTO -> symbol + "/" + currency;
            case STOCK, OPTION, FUTURE, FOREX -> symbol;
        };
    }

    /**
     * Heuristically parses an AI-provided or user-provided symbol string into a Contract.
     * <ul>
     *   <li>Ends with "-SWAP" &rarr; PERP (OKX perpetual)</li>
     *   <li>Matches [A-Z]+-[A-Z]+-\d{6} &rarr; FUTURE (OKX dated future)</li>
     *   <li>Contains "/" &rarr; CRYPTO spot</li>
     *   <li>Matches [A-Z]+-[A-Z]+ (no SWAP) &rarr; CRYPTO spot</li>
     *   <li>Default &rarr; STOCK</li>
     * </ul>
     */
    public static Contract fromString(String input) {
        Objects.requireNonNull(input, "input must not be null");
        String trimmed = input.trim().toUpperCase();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("Symbol must not be blank");
        }

        // Ends with "-SWAP" → PERP (e.g. "BTC-USDT-SWAP")
        if (trimmed.endsWith("-SWAP")) {
            String withoutSwap = trimmed.substring(0, trimmed.length() - "-SWAP".length());
            String[] parts = withoutSwap.split("-", 2);
            String base = parts[0];
            String quote = parts.length > 1 ? parts[1] : "USD";
            return cryptoPerp(base, quote, "OKX");
        }

        // Matches [A-Z]+-[A-Z]+-\d{6} → FUTURE (e.g. "BTC-USD-250328")
        if (OKX_FUTURE_PATTERN.matcher(trimmed).matches()) {
            String[] parts = trimmed.split("-", 3);
            return new Contract(parts[0], SecurityType.FUTURE, "OKX", parts[1],
                    null, null, null, null);
        }

        // Contains "/" → check if FOREX (both sides fiat) or CRYPTO spot
        if (CRYPTO_PAIR_PATTERN.matcher(trimmed).matches()) {
            String[] parts = trimmed.split("/", 2);
            if (FIAT_CURRENCIES.contains(parts[0]) && FIAT_CURRENCIES.contains(parts[1])) {
                return new Contract(parts[0], SecurityType.FOREX, "SMART", parts[1],
                        null, null, null, null);
            }
            return cryptoSpot(parts[0], parts[1], "SMART");
        }

        // Matches [A-Z]+-[A-Z]+ (no SWAP suffix) → check FOREX vs CRYPTO
        if (CRYPTO_DASH_PATTERN.matcher(trimmed).matches()) {
            String[] parts = trimmed.split("-", 2);
            if (FIAT_CURRENCIES.contains(parts[0]) && FIAT_CURRENCIES.contains(parts[1])) {
                return new Contract(parts[0], SecurityType.FOREX, "SMART", parts[1],
                        null, null, null, null);
            }
            return cryptoSpot(parts[0], parts[1], "SMART");
        }

        // Default → STOCK
        return stock(trimmed);
    }

    /**
     * Returns a human-readable display name.
     * <ul>
     *   <li>STOCK &rarr; "AAPL (Stock)"</li>
     *   <li>PERP  &rarr; "BTC-USDT Perp @OKX"</li>
     *   <li>CRYPTO &rarr; "BTC/USD Crypto @BINANCE"</li>
     *   <li>OPTION &rarr; "AAPL 250620 150C Option"</li>
     *   <li>FUTURE &rarr; "ES 250620 Future"</li>
     *   <li>FOREX &rarr; "EURUSD (Forex)"</li>
     * </ul>
     */
    public String displayName() {
        return switch (secType) {
            case STOCK -> symbol + " (Stock)";
            case PERP -> symbol + "-" + currency + " Perp @" + exchange;
            case CRYPTO -> symbol + "/" + currency + " Crypto @" + exchange;
            case OPTION -> {
                StringBuilder sb = new StringBuilder(symbol);
                if (expiry != null) {
                    sb.append(" ").append(expiry.toString().replace("-", ""));
                }
                if (strike != null) {
                    sb.append(" ").append(strike.stripTrailingZeros().toPlainString());
                }
                if (right != null) {
                    sb.append(right);
                }
                sb.append(" Option");
                yield sb.toString();
            }
            case FUTURE -> {
                StringBuilder sb = new StringBuilder(symbol);
                if (expiry != null) {
                    sb.append(" ").append(expiry.toString().replace("-", ""));
                }
                sb.append(" Future");
                yield sb.toString();
            }
            case FOREX -> symbol + " (Forex)";
        };
    }
}
