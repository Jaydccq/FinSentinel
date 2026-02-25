package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.ConfirmationProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

/**
 * User confirmation gate for risky trading operations (OpenAlice getConfirm pattern).
 *
 * <p>The agent calls this before executing risky actions to request approval.
 * Currently auto-approves most requests (single-user SSE architecture has no
 * bidirectional confirm/deny channel). The confirmation is logged for audit.
 *
 * <p><strong>Safety rule:</strong> any action that contains "live" (case-insensitive)
 * is unconditionally blocked when {@code app.confirmation.block-live-mode} is
 * {@code true} — the agent must never autonomously enable live trading.
 *
 * <p>In a future version with WebSocket or polling, this can be extended to
 * actually wait for user input before proceeding.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ConfirmationTool {

    private final ConfirmationProperties confirmationProperties;

    @Tool(description = "Request user confirmation before executing a risky action. "
            + "You MUST call this before: (1) trades exceeding the configured threshold, "
            + "(2) closing all positions, (3) switching from PAPER to LIVE mode, "
            + "(4) any action you consider high-risk. "
            + "Describe what you want to do and why.")
    public String getConfirm(
            @ToolParam(description = "Clear description of the action and why you want to do it, "
                    + "e.g. 'I want to sell all AAPL shares because earnings missed expectations'")
            String action) {

        // Block LIVE mode transitions unconditionally when configured
        if (confirmationProperties.isBlockLiveMode()
                && action != null
                && action.toLowerCase().contains("live")) {
            log.warn("BLOCKED live-mode action: {}", action);
            return String.format(
                    "BLOCKED. Action: %s — "
                    + "Switching to LIVE trading mode is not permitted via autonomous agent actions. "
                    + "The user must enable live mode manually.",
                    action);
        }

        log.info("CONFIRMATION REQUESTED: {}", action);
        return String.format(
                "APPROVED (auto). Action: %s — "
                + "Trade amount threshold: $%s. "
                + "Note: In production, this would wait for user approval. "
                + "Proceed with the action.",
                action, confirmationProperties.getTradeAmountThreshold().toPlainString());
    }
}
