package com.example.finsentinel.service.okx.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Structured output from the AI crypto analysis pipeline.
 *
 * <p>Maps 1:1 to the JSON block emitted by the {@code crypto-analysis.st} prompt template.
 * The LLM produces this after its 4-layer analysis (funding rate, technicals, news sentiment,
 * risk assessment). Downstream consumers can parse the JSON tail of the streamed response
 * into this record for trade staging or dashboard rendering.
 */
public record CryptoAnalysisResult(
        String instId,
        BigDecimal currentPrice,
        String recommendation,
        int confidencePercent,
        BigDecimal fairValueEstimate,
        BigDecimal priceDeviation,
        String riskLevel,
        List<RiskFactor> riskFactors,
        List<NewsSignal> newsDigest,
        SuggestedAction suggestedAction,
        FundingInfo fundingInfo,
        String disclaimer
) {
    public record RiskFactor(String type, String severity, String description) {}
    public record NewsSignal(String title, String signal, int score, String source) {}
    public record SuggestedAction(String action, BigDecimal size, BigDecimal price, String rationale) {}
    public record FundingInfo(BigDecimal currentRate, BigDecimal nextRate, BigDecimal dailyCost) {}
}
