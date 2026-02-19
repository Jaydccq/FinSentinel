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
import java.util.List;
import java.util.UUID;

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
        Holding h = holdingRepository.findById(holdingId)
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
