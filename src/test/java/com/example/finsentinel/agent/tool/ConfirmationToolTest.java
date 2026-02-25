package com.example.finsentinel.agent.tool;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ConfirmationToolTest {

    private final ConfirmationTool tool = new ConfirmationTool();

    @Test
    void getConfirm_autoApproves() {
        String result = tool.getConfirm("Sell all AAPL due to earnings miss");
        assertThat(result).contains("APPROVED");
        assertThat(result).contains("Sell all AAPL");
    }

    @Test
    void getConfirm_includesActionInResponse() {
        String result = tool.getConfirm("Switch to LIVE trading mode");
        assertThat(result).contains("Switch to LIVE trading mode");
    }
}
