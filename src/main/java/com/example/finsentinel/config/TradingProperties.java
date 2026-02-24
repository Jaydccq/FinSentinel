package com.example.finsentinel.config;

import com.example.finsentinel.model.enums.TradingMode;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Defines configuration beans for trading engine properties.
 *
 * <p>This class belongs to the config layer in FinSentinel.
 */

@Configuration
@ConfigurationProperties(prefix = "app.trading")
@Getter
@Setter
public class TradingProperties {
    private TradingMode defaultMode = TradingMode.PAPER;
    private AlpacaConfig alpaca = new AlpacaConfig();
    private CryptoConfig crypto = new CryptoConfig();

    @Getter
    @Setter
    public static class AlpacaConfig {
        private boolean enabled = false;
        private boolean paper = true;
        private String apiKey;
        private String secretKey;
        private String baseUrl = "https://paper-api.alpaca.markets";
        private List<String> allowedSymbols = List.of();
    }

    @Getter
    @Setter
    public static class CryptoConfig {
        private boolean enabled = false;
        private String exchange = "binance";
        private String apiKey;
        private String secretKey;
        private boolean sandbox = true;
        private List<String> allowedSymbols = List.of("BTC/USD", "ETH/USD", "SOL/USD");
    }
}
