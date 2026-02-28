package com.example.finsentinel.config;

import com.example.finsentinel.agent.tool.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.beans.factory.ObjectProvider;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class McpToolConfigTest {

    /**
     * Tools that must NEVER appear in MCP output (require user context or are internal-only).
     */
    private static final Set<String> EXCLUDED_TOOL_NAME_FRAGMENTS = Set.of(
            "trade", "brain", "userprofile", "autonomy",
            "portfolio", "thinking", "confirm");

    private ToolCallbackProvider provider;

    @BeforeEach
    void setUp() {
        var config = new McpToolConfig();
        @SuppressWarnings("unchecked")
        ObjectProvider<CryptoNewsTool> cryptoProvider = mock(ObjectProvider.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<TwitterTool> twitterProvider = mock(ObjectProvider.class);
        provider = config.mcpToolCallbackProvider(
                mock(StockMarketTool.class),
                mock(TechnicalIndicatorTool.class),
                mock(CompanyResearchTool.class),
                mock(EquityScreenerTool.class),
                mock(QuantAnalysisTool.class),
                mock(MarketCalendarTool.class),
                mock(OwnershipTool.class),
                mock(ShortInterestTool.class),
                mock(NewsAnalysisTool.class),
                mock(ComplianceCheckTool.class),
                cryptoProvider,
                twitterProvider);
    }

    @Test
    void mcpToolCallbackProvider_registersNonEmptyToolSet() {
        ToolCallback[] callbacks = provider.getToolCallbacks();
        assertThat(callbacks)
                .describedAs("Phase 1 should expose at least one tool per registered class")
                .hasSizeGreaterThanOrEqualTo(10);
    }

    @Test
    void mcpToolCallbackProvider_excludesUserContextAndInternalTools() {
        Set<String> toolNames = Arrays.stream(provider.getToolCallbacks())
                .map(cb -> cb.getToolDefinition().name().toLowerCase())
                .collect(Collectors.toSet());

        for (String fragment : EXCLUDED_TOOL_NAME_FRAGMENTS) {
            assertThat(toolNames)
                    .describedAs("MCP must not expose tools matching '%s'", fragment)
                    .noneMatch(name -> name.contains(fragment));
        }
    }

    @Test
    void mcpToolCallbackProvider_includesExpectedToolClasses() {
        Set<String> toolNames = Arrays.stream(provider.getToolCallbacks())
                .map(cb -> cb.getToolDefinition().name().toLowerCase())
                .collect(Collectors.toSet());

        // Spot-check representative tools from each registered class
        assertThat(toolNames).anyMatch(n -> n.contains("stock") || n.contains("quote"));
        assertThat(toolNames).anyMatch(n -> n.contains("rsi") || n.contains("macd") || n.contains("indicator"));
        assertThat(toolNames).anyMatch(n -> n.contains("company") || n.contains("research"));
        assertThat(toolNames).anyMatch(n -> n.contains("screen"));
        assertThat(toolNames).anyMatch(n -> n.contains("quant") || n.contains("var") || n.contains("sharpe"));
        assertThat(toolNames).anyMatch(n -> n.contains("calendar") || n.contains("earnings"));
        assertThat(toolNames).anyMatch(n -> n.contains("ownership") || n.contains("insider"));
        assertThat(toolNames).anyMatch(n -> n.contains("short") || n.contains("interest"));
        assertThat(toolNames).anyMatch(n -> n.contains("news") || n.contains("sentiment"));
        assertThat(toolNames).anyMatch(n -> n.contains("compliance"));
    }
}
