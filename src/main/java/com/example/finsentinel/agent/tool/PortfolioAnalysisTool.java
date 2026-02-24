package com.example.finsentinel.agent.tool;

import com.example.finsentinel.model.Holding;
import com.example.finsentinel.model.Portfolio;
import com.example.finsentinel.repository.HoldingRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Implements AI agent logic for portfolio analysis tool workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

@Component
@Slf4j
@RequiredArgsConstructor
public class PortfolioAnalysisTool {

    private final PortfolioRepository portfolioRepository;
    private final HoldingRepository holdingRepository;

    @Tool(description = "Analyze a user's portfolio holdings including sector concentration, " +
            "top positions by market value, unrealized P&L, and diversification risk metrics. " +
            "Use this to assess concentration risk and portfolio composition.")
    /**
     * Analyzes portfolio.
     *
     * <p>This method is defined in {@link PortfolioAnalysisTool}.
     * @param portfolioId portfolio id (String)
     * @return the analyze portfolio result (String)
     */

    public String analyzePortfolio(
            @ToolParam(description = "Portfolio UUID") String portfolioId) {
        UUID id;
        try {
            id = UUID.fromString(portfolioId);
        } catch (IllegalArgumentException e) {
            return "Invalid portfolio ID format: " + portfolioId;
        }

        Optional<Portfolio> portfolioOpt = portfolioRepository.findById(id);
        if (portfolioOpt.isEmpty()) {
            return "Portfolio not found: " + portfolioId;
        }

        Portfolio portfolio = portfolioOpt.get();
        String currentUser = resolveAuthenticatedUsername();
        if (currentUser == null || portfolio.getUser() == null
                || !currentUser.equals(portfolio.getUser().getUsername())) {
            return "Portfolio not found: " + portfolioId;
        }
        List<Holding> holdings = holdingRepository.findByPortfolioId(id);

        if (holdings.isEmpty()) {

            return "Portfolio '" + portfolio.getName() + "' has no holdings.";
        }

        BigDecimal totalMarketValue = BigDecimal.ZERO;
        List<HoldingAnalysis> analyses = new ArrayList<>();

        for (Holding h : holdings) {
            BigDecimal price = h.getCurrentPrice() != null ? h.getCurrentPrice() : h.getAverageCost();
            BigDecimal marketValue = price.multiply(h.getQuantity());
            BigDecimal costBasis = h.getAverageCost().multiply(h.getQuantity());
            BigDecimal unrealizedPnl = marketValue.subtract(costBasis);
            BigDecimal pnlPct = costBasis.compareTo(BigDecimal.ZERO) != 0
                    ? unrealizedPnl.divide(costBasis, 4, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100))
                    : BigDecimal.ZERO;

            analyses.add(new HoldingAnalysis(h.getSymbol(), h.getCompanyName(), h.getSector(),
                    marketValue, costBasis, unrealizedPnl, pnlPct));
            totalMarketValue = totalMarketValue.add(marketValue);
        }
        if (totalMarketValue.compareTo(BigDecimal.ZERO) <= 0) {
            return "Portfolio '" + portfolio.getName() + "' has zero market value and cannot be analyzed yet.";
        }

        analyses.sort((a, b) -> b.marketValue.compareTo(a.marketValue));

        BigDecimal finalTotalMarketValue = totalMarketValue;
        Map<String, BigDecimal> sectorWeights = analyses.stream()
                .filter(a -> a.sector != null)
                .collect(Collectors.groupingBy(a -> a.sector,
                        Collectors.reducing(BigDecimal.ZERO,
                                a -> a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP)
                                        .multiply(BigDecimal.valueOf(100)),
                                BigDecimal::add)));

        StringBuilder sb = new StringBuilder();
        sb.append("Portfolio Analysis: ").append(portfolio.getName()).append("\n");
        sb.append("Total Market Value: $").append(totalMarketValue.setScale(2, RoundingMode.HALF_UP)).append("\n\n");

        sb.append("Top Holdings:\n");
        for (int i = 0; i < Math.min(analyses.size(), 10); i++) {
            HoldingAnalysis a = analyses.get(i);
            BigDecimal weight = a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100));
            sb.append(String.format("  %d. %s (%s) — $%s (%.1f%%) P&L: %s%.1f%%\n",
                    i + 1, a.symbol, a.companyName != null ? a.companyName : "N/A",
                    a.marketValue.setScale(2, RoundingMode.HALF_UP),
                    weight.doubleValue(),
                    a.pnlPct.doubleValue() >= 0 ? "+" : "",
                    a.pnlPct.doubleValue()));
        }

        sb.append("\nSector Concentration:\n");
        sectorWeights.entrySet().stream()
                .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
                .forEach(e -> sb.append(String.format("  %s: %.1f%%\n", e.getKey(), e.getValue().doubleValue())));

        sb.append("\nConcentration Risk Assessment:\n");
        boolean hasRisk = false;
        for (HoldingAnalysis a : analyses) {
            BigDecimal weight = a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100));
            if (weight.doubleValue() > 20) {
                sb.append(String.format("  WARNING: %s is %.1f%% of portfolio (>20%% single-stock concentration risk)\n",
                        a.symbol, weight.doubleValue()));
                hasRisk = true;
            }
        }
        for (Map.Entry<String, BigDecimal> e : sectorWeights.entrySet()) {
            if (e.getValue().doubleValue() > 40) {
                sb.append(String.format("  WARNING: %s sector is %.1f%% of portfolio (>40%% sector concentration risk)\n",
                        e.getKey(), e.getValue().doubleValue()));
                hasRisk = true;
            }
        }
        if (!hasRisk) {
            sb.append("  Portfolio is reasonably diversified.\n");
        }

        double hhi = analyses.stream()
                .mapToDouble(a -> {
                    double w = a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP).doubleValue();
                    return w * w;
                })
                .sum() * 10000;
        sb.append(String.format("\nHerfindahl-Hirschman Index (HHI): %.0f", hhi));
        if (hhi > 2500) sb.append(" (Highly concentrated)");
        else if (hhi > 1500) sb.append(" (Moderately concentrated)");

        else sb.append(" (Well diversified)");


        return sb.toString();
    }

    private String resolveAuthenticatedUsername() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            return null;
        }
        return auth.getName();
    }

    /**
     * Implements AI agent behavior for holding analysis workflows.
     *
     * <p>This record belongs to the agent layer in FinSentinel.
     */

    private record HoldingAnalysis(String symbol, String companyName, String sector,
                                   BigDecimal marketValue, BigDecimal costBasis,
                                   BigDecimal unrealizedPnl, BigDecimal pnlPct) {}
}
