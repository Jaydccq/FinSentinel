package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.ConfirmationProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class ConfirmationToolTest {

    private ConfirmationProperties properties;
    private ConfirmationTool tool;

    @BeforeEach
    void setUp() {
        properties = new ConfirmationProperties();
        tool = new ConfirmationTool(properties);
    }

    // ── LIVE mode blocking ──────────────────────────────────────────

    @Test
    void getConfirm_blocksLiveModeTransition() {
        String result = tool.getConfirm("Switch to LIVE trading mode");
        assertThat(result).startsWith("BLOCKED");
        assertThat(result).contains("Switch to LIVE trading mode");
        assertThat(result).contains("not permitted");
    }

    @Test
    void getConfirm_blocksLiveModeCaseInsensitive() {
        String result = tool.getConfirm("Enable live mode for real trades");
        assertThat(result).startsWith("BLOCKED");
    }

    @Test
    void getConfirm_allowsLiveModeWhenBlockingDisabled() {
        properties.setBlockLiveMode(false);
        String result = tool.getConfirm("Switch to LIVE trading mode");
        assertThat(result).contains("APPROVED");
    }

    // ── Normal auto-approval ────────────────────────────────────────

    @Test
    void getConfirm_autoApprovesNormalAction() {
        String result = tool.getConfirm("Sell all AAPL due to earnings miss");
        assertThat(result).contains("APPROVED");
        assertThat(result).contains("Sell all AAPL");
    }

    @Test
    void getConfirm_includesActionInResponse() {
        String result = tool.getConfirm("Close 50 shares of MSFT");
        assertThat(result).contains("Close 50 shares of MSFT");
    }

    // ── Configurable threshold ──────────────────────────────────────

    @Test
    void getConfirm_showsDefaultThreshold() {
        String result = tool.getConfirm("Buy 100 shares of NVDA");
        assertThat(result).contains("$10000");
    }

    @Test
    void getConfirm_showsCustomThreshold() {
        properties.setTradeAmountThreshold(new BigDecimal("5000"));
        String result = tool.getConfirm("Buy 100 shares of NVDA");
        assertThat(result).contains("$5000");
        assertThat(result).doesNotContain("$10000");
    }
}
