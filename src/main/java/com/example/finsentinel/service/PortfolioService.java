package com.example.finsentinel.service;

import com.example.finsentinel.dto.portfolio.*;
import com.example.finsentinel.mapper.HoldingMapper;
import com.example.finsentinel.mapper.PortfolioMapper;
import com.example.finsentinel.model.Holding;
import com.example.finsentinel.model.Portfolio;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.HoldingRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import com.example.finsentinel.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Implements portfolio service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class PortfolioService {

    private final PortfolioRepository portfolioRepository;
    private final HoldingRepository holdingRepository;
    private final UserRepository userRepository;
    private final PortfolioMapper portfolioMapper;
    private final HoldingMapper holdingMapper;

    /**
     * Executes create.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * create workflow.
     * @param request request (PortfolioRequest)
     * @param userId user id (UUID)
     * @return the create result (PortfolioResponse)
     */

    public PortfolioResponse create(PortfolioRequest request, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        Portfolio portfolio = Portfolio.builder()
                .name(request.name())
                .description(request.description())
                .user(user)
                .totalValue(BigDecimal.ZERO)
                .build();

        return portfolioMapper.toResponse(portfolioRepository.save(portfolio));
    }

    /**
     * Lists by user.
     *
     * <p>This method is defined in {@link PortfolioService}.
     * @param userId user id (UUID)
     * @return the list by user result (List<PortfolioResponse>)
     */

    @Transactional(readOnly = true)
    public List<PortfolioResponse> listByUser(UUID userId) {

        return portfolioRepository.findByUserId(userId).stream()
                .map(portfolioMapper::toResponse).toList();
    }

    /**
     * Returns by id.
     *
     * <p>This method is defined in {@link PortfolioService}.
     * @param portfolioId portfolio id (UUID)
     * @param userId user id (UUID)
     * @return the get by id result (PortfolioResponse)
     */

    @Transactional(readOnly = true)
    public PortfolioResponse getById(UUID portfolioId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);

        return portfolioMapper.toResponse(p);
    }

    /**
     * Executes update.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * update workflow.
     * @param portfolioId portfolio id (UUID)
     * @param request request (PortfolioRequest)
     * @param userId user id (UUID)
     * @return the update result (PortfolioResponse)
     */

    public PortfolioResponse update(UUID portfolioId, PortfolioRequest request, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        p.setName(request.name());
        p.setDescription(request.description());

        return portfolioMapper.toResponse(portfolioRepository.save(p));
    }

    /**
     * Executes delete.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * delete workflow.
     * @param portfolioId portfolio id (UUID)
     * @param userId user id (UUID)
     */

    public void delete(UUID portfolioId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        portfolioRepository.delete(p);
    }

    // --- Holding operations ---

    /**
     * Executes add holding.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * add holding workflow.
     * @param portfolioId portfolio id (UUID)
     * @param request request (HoldingRequest)
     * @param userId user id (UUID)
     * @return the add holding result (HoldingResponse)
     */

    public HoldingResponse addHolding(UUID portfolioId, HoldingRequest request, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        Holding holding = Holding.builder()
                .portfolio(p)
                .symbol(request.symbol().toUpperCase())
                .companyName(request.companyName())
                .quantity(request.quantity())
                .averageCost(request.averageCost())
                .sector(request.sector())
                .build();
        holding = holdingRepository.save(holding);
        recalculateTotalValue(p);

        return holdingMapper.toResponse(holding);
    }

    /**
     * Lists holdings.
     *
     * <p>This method is defined in {@link PortfolioService}.
     * @param portfolioId portfolio id (UUID)
     * @param userId user id (UUID)
     * @return the list holdings result (List<HoldingResponse>)
     */

    @Transactional(readOnly = true)
    public List<HoldingResponse> listHoldings(UUID portfolioId, UUID userId) {
        findOwnedPortfolio(portfolioId, userId);

        return holdingRepository.findByPortfolioId(portfolioId).stream()
                .map(holdingMapper::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public PortfolioAnalyticsResponse getAnalytics(UUID portfolioId, UUID userId) {
        Portfolio portfolio = findOwnedPortfolio(portfolioId, userId);
        List<Holding> holdings = holdingRepository.findByPortfolioId(portfolioId);

        if (holdings.isEmpty()) {
            return new PortfolioAnalyticsResponse(
                    BigDecimal.ZERO, Map.of(), 0.0, "N/A", List.of(), List.of());
        }

        BigDecimal totalMarketValue = BigDecimal.ZERO;
        List<PortfolioAnalyticsResponse.HoldingWeight> weights = new ArrayList<>();

        for (Holding h : holdings) {
            BigDecimal price = h.getCurrentPrice() != null ? h.getCurrentPrice() : h.getAverageCost();
            BigDecimal marketValue = price.multiply(h.getQuantity());
            BigDecimal costBasis = h.getAverageCost().multiply(h.getQuantity());
            BigDecimal unrealizedPnl = marketValue.subtract(costBasis);
            BigDecimal pnlPct = costBasis.compareTo(BigDecimal.ZERO) != 0
                    ? unrealizedPnl.divide(costBasis, 4, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100))
                    : BigDecimal.ZERO;

            totalMarketValue = totalMarketValue.add(marketValue);
            weights.add(new PortfolioAnalyticsResponse.HoldingWeight(
                    h.getSymbol(), h.getCompanyName(), h.getSector(),
                    marketValue, BigDecimal.ZERO, unrealizedPnl, pnlPct));
        }

        if (totalMarketValue.compareTo(BigDecimal.ZERO) <= 0) {
            return new PortfolioAnalyticsResponse(
                    BigDecimal.ZERO, Map.of(), 0.0, "N/A", List.of(), List.of("Portfolio market value is zero"));
        }

        // Calculate weight percentages
        BigDecimal finalTotal = totalMarketValue;
        weights = weights.stream()
                .map(w -> new PortfolioAnalyticsResponse.HoldingWeight(
                        w.symbol(), w.companyName(), w.sector(), w.marketValue(),
                        w.marketValue().divide(finalTotal, 4, RoundingMode.HALF_UP)
                                .multiply(BigDecimal.valueOf(100)),
                        w.unrealizedPnl(), w.pnlPercent()))
                .sorted((a, b) -> b.marketValue().compareTo(a.marketValue()))
                .toList();

        // Sector allocation
        Map<String, BigDecimal> sectorAllocation = weights.stream()
                .filter(w -> w.sector() != null)
                .collect(Collectors.groupingBy(
                        PortfolioAnalyticsResponse.HoldingWeight::sector,
                        Collectors.reducing(BigDecimal.ZERO,
                                PortfolioAnalyticsResponse.HoldingWeight::weightPercent,
                                BigDecimal::add)));

        // HHI calculation
        double hhi = weights.stream()
                .mapToDouble(w -> {
                    double wPct = w.marketValue().divide(finalTotal, 4, RoundingMode.HALF_UP).doubleValue();
                    return wPct * wPct;
                })
                .sum() * 10000;

        String hhiClassification;
        if (hhi > 2500) hhiClassification = "Highly Concentrated";
        else if (hhi > 1500) hhiClassification = "Moderately Concentrated";
        else hhiClassification = "Well Diversified";

        // Concentration warnings
        List<String> warnings = new ArrayList<>();
        for (PortfolioAnalyticsResponse.HoldingWeight w : weights) {
            if (w.weightPercent().doubleValue() > 20) {
                warnings.add(String.format("%s is %.1f%% of portfolio (>20%% single-stock concentration risk)",
                        w.symbol(), w.weightPercent().doubleValue()));
            }
        }
        for (Map.Entry<String, BigDecimal> e : sectorAllocation.entrySet()) {
            if (e.getValue().doubleValue() > 40) {
                warnings.add(String.format("%s sector is %.1f%% of portfolio (>40%% sector concentration risk)",
                        e.getKey(), e.getValue().doubleValue()));
            }
        }

        return new PortfolioAnalyticsResponse(
                totalMarketValue.setScale(2, RoundingMode.HALF_UP),
                sectorAllocation, hhi, hhiClassification, weights, warnings);
    }

    /**
     * Updates holding.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * update holding workflow.
     * @param portfolioId portfolio id (UUID)
     * @param holdingId holding id (UUID)
     * @param request request (HoldingRequest)
     * @param userId user id (UUID)
     * @return the update holding result (HoldingResponse)
     */

    public HoldingResponse updateHolding(UUID portfolioId, UUID holdingId,
                                          HoldingRequest request, UUID userId) {
        findOwnedPortfolio(portfolioId, userId);
        Holding h = holdingRepository.findByIdAndPortfolioId(holdingId, portfolioId)
                .orElseThrow(() -> new IllegalArgumentException("Holding not found"));
        h.setSymbol(request.symbol().toUpperCase());
        h.setCompanyName(request.companyName());
        h.setQuantity(request.quantity());
        h.setAverageCost(request.averageCost());
        h.setSector(request.sector());
        h = holdingRepository.save(h);
        recalculateTotalValue(h.getPortfolio());

        return holdingMapper.toResponse(h);
    }

    /**
     * Deletes holding.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * delete holding workflow.
     * @param portfolioId portfolio id (UUID)
     * @param holdingId holding id (UUID)
     * @param userId user id (UUID)
     */

    public void deleteHolding(UUID portfolioId, UUID holdingId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        holdingRepository.findByIdAndPortfolioId(holdingId, portfolioId)
                .orElseThrow(() -> new IllegalArgumentException("Holding not found"));
        holdingRepository.deleteById(holdingId);
        recalculateTotalValue(p);
    }

    // --- Helpers ---

    /**
     * Finds owned portfolio.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * find owned portfolio workflow.
     * @param portfolioId portfolio id (UUID)
     * @param userId user id (UUID)
     * @return the find owned portfolio result (Portfolio)
     */

    private Portfolio findOwnedPortfolio(UUID portfolioId, UUID userId) {
        Portfolio p = portfolioRepository.findById(portfolioId)
                .orElseThrow(() -> new IllegalArgumentException("Portfolio not found"));
        if (!p.getUser().getId().equals(userId)) {

            throw new IllegalArgumentException("Portfolio not found");
        }
        return p;
    }

    /**
     * Executes recalculate total value.
     *
     * <p>This method belongs to {@link PortfolioService} and encapsulates the
     * recalculate total value workflow.
     * @param portfolio portfolio (Portfolio)
     */

    private void recalculateTotalValue(Portfolio portfolio) {
        BigDecimal total = holdingRepository.findByPortfolioId(portfolio.getId()).stream()
                .map(h -> {
                    BigDecimal price = h.getCurrentPrice() != null ? h.getCurrentPrice() : h.getAverageCost();
                    return h.getQuantity().multiply(price);
                })
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        portfolio.setTotalValue(total);
        portfolioRepository.save(portfolio);
    }
}
