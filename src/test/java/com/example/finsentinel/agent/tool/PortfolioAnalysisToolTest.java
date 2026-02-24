package com.example.finsentinel.agent.tool;

import com.example.finsentinel.model.Holding;
import com.example.finsentinel.model.Portfolio;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.HoldingRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Implements AI agent behavior for portfolio analysis tool test workflows.
 *
 * <p>This class belongs to the agent layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class PortfolioAnalysisToolTest {

    @Mock private PortfolioRepository portfolioRepository;
    @Mock private HoldingRepository holdingRepository;

    private PortfolioAnalysisTool tool;


    @BeforeEach
    void setUp() {
        tool = new PortfolioAnalysisTool(portfolioRepository, holdingRepository);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("tester", "N/A", List.of()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }


    @Test
    void analyzePortfolio_shouldReturnConcentrationMetrics() {
        UUID portfolioId = UUID.randomUUID();
        Portfolio portfolio = Portfolio.builder()
                .id(portfolioId)
                .name("Test Portfolio")
                .user(User.builder().username("tester").build())
                .totalValue(new BigDecimal("100000.00"))
                .build();

        Holding h1 = Holding.builder()
                .symbol("AAPL").companyName("Apple Inc")
                .quantity(new BigDecimal("100")).averageCost(new BigDecimal("150.00"))
                .currentPrice(new BigDecimal("175.00")).sector("Technology")
                .build();
        Holding h2 = Holding.builder()
                .symbol("MSFT").companyName("Microsoft Corp")
                .quantity(new BigDecimal("50")).averageCost(new BigDecimal("300.00"))
                .currentPrice(new BigDecimal("350.00")).sector("Technology")
                .build();
        Holding h3 = Holding.builder()
                .symbol("JPM").companyName("JPMorgan Chase")
                .quantity(new BigDecimal("30")).averageCost(new BigDecimal("140.00"))
                .currentPrice(new BigDecimal("160.00")).sector("Financial")
                .build();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(portfolio));
        when(holdingRepository.findByPortfolioId(portfolioId)).thenReturn(List.of(h1, h2, h3));

        String result = tool.analyzePortfolio(portfolioId.toString());

        assertThat(result).contains("Test Portfolio");
        assertThat(result).contains("AAPL");
        assertThat(result).contains("Technology");
        assertThat(result).contains("Concentration");
    }


    @Test
    void analyzePortfolio_withInvalidId_shouldReturnError() {
        String result = tool.analyzePortfolio("not-a-uuid");
        assertThat(result).contains("Invalid portfolio ID");
    }


    @Test
    void analyzePortfolio_notFound_shouldReturnError() {
        UUID id = UUID.randomUUID();
        when(portfolioRepository.findById(id)).thenReturn(Optional.empty());
        String result = tool.analyzePortfolio(id.toString());
        assertThat(result).contains("not found");
    }

    @Test
    void analyzePortfolio_whenNotOwnedByCurrentUser_shouldReturnNotFound() {
        UUID portfolioId = UUID.randomUUID();
        Portfolio portfolio = Portfolio.builder()
                .id(portfolioId)
                .name("Other Portfolio")
                .user(User.builder().username("someone-else").build())
                .build();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(portfolio));

        String result = tool.analyzePortfolio(portfolioId.toString());

        assertThat(result).contains("Portfolio not found");
    }
}
