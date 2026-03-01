package com.example.finsentinel.service.okx;

import com.example.finsentinel.agent.tool.CryptoNewsTool;
import com.example.finsentinel.agent.tool.OkxTradingTool;
import com.example.finsentinel.agent.tool.StockMarketTool;
import com.example.finsentinel.agent.tool.TechnicalIndicatorTool;
import com.example.finsentinel.service.okx.dto.OkxPosition;
import com.example.finsentinel.service.okx.dto.OkxResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Dedicated service for AI-powered crypto derivatives analysis.
 *
 * <p>Mirrors the pattern of {@code StockAnalysisService}: creates a lightweight
 * {@link ChatClient} wired only with crypto-relevant tools (OKX trading, crypto news,
 * technical indicators, market data). The system prompt is loaded from the
 * {@code crypto-analysis.st} template with the instrument ID substituted at call time.
 *
 * <p>Provides two streaming methods:
 * <ul>
 *   <li>{@link #streamAnalysis(String)} — single-instrument 4-layer analysis
 *       (funding rate, technicals, news sentiment, risk assessment)</li>
 *   <li>{@link #streamHealthCheck(UUID)} — portfolio-wide health check across
 *       all open OKX positions</li>
 * </ul>
 *
 * <p>Gated by {@code app.trading.okx.enabled=true} — the bean is not created
 * unless OKX integration is explicitly enabled.
 */
@Service
@Slf4j
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class OkxAnalysisService {

    private final ChatClient cryptoAnalysisChatClient;
    private final OkxApiClient okxApiClient;
    private final String cryptoAnalysisTemplate;

    private static final String HEALTH_CHECK_SYSTEM_PROMPT =
            "You are FinSentinel, an AI crypto portfolio analyst. " +
            "Evaluate the overall health of the user's OKX derivatives portfolio. " +
            "For each position, assess leverage risk, liquidation distance, unrealized PnL, " +
            "and funding cost exposure. Provide a concise portfolio-level risk summary " +
            "with actionable recommendations. Keep total output under 1500 words.";

    public OkxAnalysisService(
            ChatModel chatModel,
            OkxApiClient okxApiClient,
            OkxTradingTool okxTradingTool,
            StockMarketTool stockMarketTool,
            TechnicalIndicatorTool technicalIndicatorTool,
            ObjectProvider<CryptoNewsTool> cryptoNewsToolProvider) {

        this.okxApiClient = okxApiClient;
        this.cryptoAnalysisTemplate = loadTemplate();

        // Build tool list — CryptoNewsTool is optional (gated by app.crypto-news.enabled)
        var tools = new ArrayList<Object>(List.of(
                okxTradingTool, stockMarketTool, technicalIndicatorTool));

        CryptoNewsTool cryptoNewsTool = cryptoNewsToolProvider.getIfAvailable();
        if (cryptoNewsTool != null) {
            tools.add(cryptoNewsTool);
        }

        this.cryptoAnalysisChatClient = ChatClient.builder(chatModel)
                .defaultSystem("You are FinSentinel, an AI crypto derivatives analyst. " +
                        "Follow the user's analysis instructions precisely. " +
                        "Output exactly one JSON block when instructed. " +
                        "Keep narrative concise (800-1200 words).")
                .defaultTools(tools.toArray())
                .build();
    }

    /**
     * Stream a crypto analysis for the given instrument ID.
     *
     * <p>Loads the {@code crypto-analysis.st} template, substitutes {@code {instId}},
     * and streams the LLM response token-by-token via Reactor Flux.
     *
     * @param instId OKX instrument ID, e.g. "BTC-USDT-SWAP"
     * @return streaming text chunks from the LLM
     */
    public Flux<String> streamAnalysis(String instId) {
        String resolvedInstId = instId.toUpperCase().trim();
        log.info("Starting crypto analysis stream for instId={}", resolvedInstId);

        String prompt = cryptoAnalysisTemplate.replace("{instId}", resolvedInstId);

        return cryptoAnalysisChatClient.prompt()
                .user(prompt)
                .stream()
                .content();
    }

    /**
     * Stream a portfolio health check across all open OKX positions.
     *
     * <p>Fetches current positions from the OKX API, builds a summary of each position
     * (instrument, side, size, entry price, PnL, leverage, liquidation price), and asks
     * the LLM to evaluate overall portfolio health with actionable recommendations.
     *
     * @param userId the user's ID (for logging/audit context)
     * @return streaming text chunks from the LLM
     */
    public Flux<String> streamHealthCheck(UUID userId) {
        log.info("Starting OKX portfolio health check for userId={}", userId);

        StringBuilder healthPrompt = new StringBuilder();
        healthPrompt.append("## OKX Portfolio Health Check\n\n");

        OkxResponse<OkxPosition> positionsResponse = okxApiClient.getPositions();
        if (!positionsResponse.isSuccess() || positionsResponse.data().isEmpty()) {
            healthPrompt.append("No open OKX positions found. ")
                    .append("Provide general crypto market health assessment ")
                    .append("and recommendations for portfolio construction.\n");
        } else {
            List<OkxPosition> positions = positionsResponse.data();
            healthPrompt.append(String.format("The user has %d open position(s):\n\n", positions.size()));

            for (OkxPosition pos : positions) {
                String side = pos.posSide() != null && !pos.posSide().isEmpty()
                        ? pos.posSide()
                        : (pos.pos() != null && pos.pos().startsWith("-") ? "short" : "long");

                healthPrompt.append(String.format("- **%s** | %s | size=%s | entry=%s | mark=%s | PnL=%s | lever=%sx | liq=%s\n",
                        pos.instId(),
                        side,
                        pos.pos() != null ? pos.pos() : "?",
                        pos.avgPx() != null ? pos.avgPx() : "?",
                        pos.markPx() != null ? pos.markPx() : "?",
                        pos.upl() != null ? pos.upl() : "?",
                        pos.lever() != null ? pos.lever() : "?",
                        pos.liqPx() != null && !pos.liqPx().isEmpty() ? pos.liqPx() : "N/A"));
            }

            healthPrompt.append("\nFor each position, assess:\n")
                    .append("1. Leverage risk and distance to liquidation\n")
                    .append("2. Unrealized PnL trend and funding cost exposure\n")
                    .append("3. Whether to hold, reduce, or close the position\n\n")
                    .append("Then provide a portfolio-level risk summary with:\n")
                    .append("- Overall risk rating (LOW / MEDIUM / HIGH / CRITICAL)\n")
                    .append("- Total exposure and margin utilization assessment\n")
                    .append("- Correlation risk (are positions directionally aligned?)\n")
                    .append("- Top 3 actionable recommendations\n");
        }

        return cryptoAnalysisChatClient.prompt()
                .system(HEALTH_CHECK_SYSTEM_PROMPT)
                .user(healthPrompt.toString())
                .stream()
                .content();
    }

    /**
     * Load the crypto-analysis.st template from classpath resources.
     * Falls back to a minimal prompt if the template is missing.
     */
    private String loadTemplate() {
        try (InputStream is = getClass().getResourceAsStream("/prompts/crypto-analysis.st")) {
            if (is == null) {
                log.warn("crypto-analysis.st template not found on classpath, using fallback prompt");
                return fallbackPrompt();
            }
            String template = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            log.info("Loaded crypto-analysis.st template ({} chars)", template.length());
            return template;
        } catch (IOException e) {
            log.error("Failed to load crypto-analysis.st template", e);
            return fallbackPrompt();
        }
    }

    private String fallbackPrompt() {
        return "Perform a comprehensive crypto derivatives analysis for {instId} " +
                "using all available tools. Include funding rate analysis, technical indicators, " +
                "news sentiment, and risk assessment. End with a single JSON block containing " +
                "your structured recommendation.";
    }
}
