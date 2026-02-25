package com.example.finsentinel.agent.tool;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

/**
 * User confirmation gate for risky trading operations (OpenAlice getConfirm pattern).
 *
 * <p>The agent calls this before executing risky actions to request approval.
 * Currently auto-approves all requests (single-user SSE architecture has no
 * bidirectional confirm/deny channel). The confirmation is logged for audit.
 *
 * <p>In a future version with WebSocket or polling, this can be extended to
 * actually wait for user input before proceeding.
 */
@Component
@Slf4j
public class ConfirmationTool {

    @Tool(description = "Request user confirmation before executing a risky action. "
            + "You MUST call this before: (1) trades exceeding $10,000, (2) closing all positions, "
            + "(3) switching from PAPER to LIVE mode, (4) any action you consider high-risk. "
            + "Currently auto-approved. Describe what you want to do and why.")
    public String getConfirm(
            @ToolParam(description = "Clear description of the action and why you want to do it, "
                    + "e.g. 'I want to sell all AAPL shares because earnings missed expectations'")
            String action) {
        log.info("CONFIRMATION REQUESTED: {}", action);
        return String.format(
                "APPROVED (auto). Action: %s — "
                + "Note: In production, this would wait for user approval. "
                + "Proceed with the action.",
                action);
    }
}
