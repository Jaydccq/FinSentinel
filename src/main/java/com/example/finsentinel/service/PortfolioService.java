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

    @Transactional(readOnly = true)
    public List<PortfolioResponse> listByUser(UUID userId) {
        return portfolioRepository.findByUserId(userId).stream()
                .map(portfolioMapper::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public PortfolioResponse getById(UUID portfolioId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        return portfolioMapper.toResponse(p);
    }

    public PortfolioResponse update(UUID portfolioId, PortfolioRequest request, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        p.setName(request.name());
        p.setDescription(request.description());
        return portfolioMapper.toResponse(portfolioRepository.save(p));
    }

    public void delete(UUID portfolioId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        portfolioRepository.delete(p);
    }

    // --- Holding operations ---

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

    @Transactional(readOnly = true)
    public List<HoldingResponse> listHoldings(UUID portfolioId, UUID userId) {
        findOwnedPortfolio(portfolioId, userId);
        return holdingRepository.findByPortfolioId(portfolioId).stream()
                .map(holdingMapper::toResponse).toList();
    }

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

    public void deleteHolding(UUID portfolioId, UUID holdingId, UUID userId) {
        Portfolio p = findOwnedPortfolio(portfolioId, userId);
        holdingRepository.deleteById(holdingId);
        recalculateTotalValue(p);
    }

    // --- Helpers ---

    private Portfolio findOwnedPortfolio(UUID portfolioId, UUID userId) {
        Portfolio p = portfolioRepository.findById(portfolioId)
                .orElseThrow(() -> new IllegalArgumentException("Portfolio not found"));
        if (!p.getUser().getId().equals(userId)) {
            throw new IllegalArgumentException("Portfolio not found");
        }
        return p;
    }

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
