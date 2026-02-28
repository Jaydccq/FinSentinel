package com.example.finsentinel.config;

import com.example.finsentinel.agent.tool.*;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Registers Phase 1 (stateless) tools for MCP server exposure.
 *
 * <p>Only tools that do <em>not</em> require user-specific context are exposed.
 * Excluded tools: TradingTool, BrainTool, UserProfileTool, AutonomyTool,
 * PortfolioAnalysisTool (need user context), ThinkingTool, ConfirmationTool
 * (internal agent-only).
 *
 * <p>The {@code tool-callback-converter} auto-configuration in
 * {@code spring-ai-starter-mcp-server-webmvc} automatically converts these
 * {@link ToolCallbackProvider} beans into MCP tool specifications.
 */
@Configuration
@ConditionalOnProperty(name = "app.mcp.enabled", havingValue = "true")
public class McpToolConfig {

    @Bean
    public ToolCallbackProvider mcpToolCallbackProvider(
            StockMarketTool stockMarketTool,
            TechnicalIndicatorTool technicalIndicatorTool,
            CompanyResearchTool companyResearchTool,
            EquityScreenerTool equityScreenerTool,
            QuantAnalysisTool quantAnalysisTool,
            MarketCalendarTool marketCalendarTool,
            OwnershipTool ownershipTool,
            ShortInterestTool shortInterestTool,
            NewsAnalysisTool newsAnalysisTool,
            ComplianceCheckTool complianceCheckTool,
            ObjectProvider<CryptoNewsTool> cryptoNewsToolProvider,
            ObjectProvider<TwitterTool> twitterToolProvider) {

        var tools = new java.util.ArrayList<Object>(java.util.List.of(
                stockMarketTool, technicalIndicatorTool, companyResearchTool,
                equityScreenerTool, quantAnalysisTool, marketCalendarTool,
                ownershipTool, shortInterestTool, newsAnalysisTool,
                complianceCheckTool));

        CryptoNewsTool cryptoNewsTool = cryptoNewsToolProvider.getIfAvailable();
        if (cryptoNewsTool != null) tools.add(cryptoNewsTool);
        TwitterTool twitterTool = twitterToolProvider.getIfAvailable();
        if (twitterTool != null) tools.add(twitterTool);

        return MethodToolCallbackProvider.builder()
                .toolObjects(tools.toArray())
                .build();
    }
}
