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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Implements portfolio service test business operations and integrations.
 *
 * <p>This class belongs to the service layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class PortfolioServiceTest {

    @Mock private PortfolioRepository portfolioRepository;
    @Mock private HoldingRepository holdingRepository;
    @Mock private UserRepository userRepository;
    @Mock private PortfolioMapper portfolioMapper;
    @Mock private HoldingMapper holdingMapper;

    private PortfolioService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID otherUserId = UUID.randomUUID();
    private final UUID portfolioId = UUID.randomUUID();
    private User testUser;


    @BeforeEach
    void setUp() {
        service = new PortfolioService(portfolioRepository, holdingRepository, userRepository,
                portfolioMapper, holdingMapper);
        testUser = User.builder().id(userId).username("testuser").build();
    }


    @Test
    void create_shouldReturnPortfolioWithZeroValue() {
        when(userRepository.findById(userId)).thenReturn(Optional.of(testUser));
        when(portfolioRepository.save(any(Portfolio.class))).thenAnswer(inv -> {
            Portfolio p = inv.getArgument(0);
            p.setId(portfolioId);
            p.setCreatedAt(LocalDateTime.now());
            return p;
        });
        PortfolioResponse expected = new PortfolioResponse(portfolioId, "My Portfolio", "Test",
                BigDecimal.ZERO, List.of(), LocalDateTime.now());
        when(portfolioMapper.toResponse(any(Portfolio.class))).thenReturn(expected);

        PortfolioResponse response = service.create(new PortfolioRequest("My Portfolio", "Test"), userId);

        assertThat(response.name()).isEqualTo("My Portfolio");
        assertThat(response.description()).isEqualTo("Test");
        assertThat(response.totalValue()).isEqualByComparingTo(BigDecimal.ZERO);
    }


    @Test
    void listByUser_shouldReturnOnlyOwnedPortfolios() {
        Portfolio p1 = buildPortfolio("P1", userId);
        Portfolio p2 = buildPortfolio("P2", userId);
        when(portfolioRepository.findByUserId(userId)).thenReturn(List.of(p1, p2));
        when(portfolioMapper.toResponse(p1)).thenReturn(
                new PortfolioResponse(portfolioId, "P1", null, BigDecimal.ZERO, List.of(), LocalDateTime.now()));
        when(portfolioMapper.toResponse(p2)).thenReturn(
                new PortfolioResponse(UUID.randomUUID(), "P2", null, BigDecimal.ZERO, List.of(), LocalDateTime.now()));

        List<PortfolioResponse> result = service.listByUser(userId);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).name()).isEqualTo("P1");
    }


    @Test
    void getById_shouldThrowForWrongOwner() {
        Portfolio p = buildPortfolio("P", otherUserId);
        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(p));

        assertThatThrownBy(() -> service.getById(portfolioId, userId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Portfolio not found");
    }


    @Test
    void update_shouldModifyNameAndDescription() {
        Portfolio p = buildPortfolio("Old Name", userId);
        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(p));
        when(portfolioRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(portfolioMapper.toResponse(any(Portfolio.class))).thenAnswer(inv -> {
            Portfolio saved = inv.getArgument(0);
            return new PortfolioResponse(saved.getId(), saved.getName(), saved.getDescription(),
                    BigDecimal.ZERO, List.of(), LocalDateTime.now());
        });

        PortfolioResponse result = service.update(portfolioId,
                new PortfolioRequest("New Name", "New Desc"), userId);

        assertThat(result.name()).isEqualTo("New Name");
        assertThat(result.description()).isEqualTo("New Desc");
    }


    @Test
    void delete_shouldCallRepositoryDelete() {
        Portfolio p = buildPortfolio("P", userId);
        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(p));

        service.delete(portfolioId, userId);

        verify(portfolioRepository).delete(p);
    }


    @Test
    void addHolding_shouldRecalculateTotalValue() {
        Portfolio p = buildPortfolio("P", userId);
        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(p));
        when(holdingRepository.save(any(Holding.class))).thenAnswer(inv -> {
            Holding h = inv.getArgument(0);
            h.setId(UUID.randomUUID());
            return h;
        });
        when(holdingRepository.findByPortfolioId(portfolioId)).thenReturn(List.of(
                Holding.builder().quantity(new BigDecimal("10")).averageCost(new BigDecimal("150")).build()
        ));
        when(portfolioRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(holdingMapper.toResponse(any(Holding.class))).thenAnswer(inv -> {
            Holding h = inv.getArgument(0);
            return new HoldingResponse(h.getId(), h.getSymbol(), h.getCompanyName(),
                    h.getQuantity(), h.getAverageCost(), h.getCurrentPrice(), h.getSector());
        });

        HoldingResponse result = service.addHolding(portfolioId,
                new HoldingRequest("AAPL", "Apple Inc.", new BigDecimal("10"), new BigDecimal("150"), "Technology"),
                userId);

        assertThat(result.symbol()).isEqualTo("AAPL");
        assertThat(result.quantity()).isEqualByComparingTo(new BigDecimal("10"));

        ArgumentCaptor<Portfolio> captor = ArgumentCaptor.forClass(Portfolio.class);
        verify(portfolioRepository, atLeast(1)).save(captor.capture());
        Portfolio saved = captor.getAllValues().stream()
                .filter(pp -> pp.getTotalValue() != null && pp.getTotalValue().compareTo(BigDecimal.ZERO) > 0)
                .findFirst().orElse(null);
        assertThat(saved).isNotNull();
        assertThat(saved.getTotalValue()).isEqualByComparingTo(new BigDecimal("1500"));
    }


    @Test
    void updateHolding_shouldUpdateFields() {
        Portfolio p = buildPortfolio("P", userId);
        UUID holdingId = UUID.randomUUID();
        Holding existing = Holding.builder().id(holdingId).portfolio(p).symbol("AAPL")
                .quantity(new BigDecimal("10")).averageCost(new BigDecimal("150")).build();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(p));
        when(holdingRepository.findByIdAndPortfolioId(holdingId, portfolioId)).thenReturn(Optional.of(existing));
        when(holdingRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(holdingRepository.findByPortfolioId(portfolioId)).thenReturn(List.of(existing));
        when(portfolioRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(holdingMapper.toResponse(any(Holding.class))).thenAnswer(inv -> {
            Holding h = inv.getArgument(0);
            return new HoldingResponse(h.getId(), h.getSymbol(), h.getCompanyName(),
                    h.getQuantity(), h.getAverageCost(), h.getCurrentPrice(), h.getSector());
        });

        HoldingResponse result = service.updateHolding(portfolioId, holdingId,
                new HoldingRequest("MSFT", "Microsoft", new BigDecimal("20"), new BigDecimal("300"), "Technology"),
                userId);

        assertThat(result.symbol()).isEqualTo("MSFT");
        assertThat(result.quantity()).isEqualByComparingTo(new BigDecimal("20"));
    }

    @Test
    void updateHolding_shouldThrowWhenHoldingNotInPortfolio() {
        Portfolio ownedPortfolio = buildPortfolio("Owned", userId);
        UUID holdingId = UUID.randomUUID();
        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(ownedPortfolio));
        when(holdingRepository.findByIdAndPortfolioId(holdingId, portfolioId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.updateHolding(
                portfolioId,
                holdingId,
                new HoldingRequest("MSFT", "Microsoft", new BigDecimal("20"),
                        new BigDecimal("300"), "Technology"),
                userId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Holding not found");

        verify(holdingRepository, never()).save(any(Holding.class));
    }


    @Test
    void deleteHolding_shouldCallDeleteAndRecalculate() {
        Portfolio p = buildPortfolio("P", userId);
        UUID holdingId = UUID.randomUUID();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(p));
        when(holdingRepository.findByIdAndPortfolioId(holdingId, portfolioId))
                .thenReturn(Optional.of(Holding.builder().id(holdingId).portfolio(p).build()));
        when(holdingRepository.findByPortfolioId(portfolioId)).thenReturn(List.of());
        when(portfolioRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.deleteHolding(portfolioId, holdingId, userId);

        verify(holdingRepository).deleteById(holdingId);
    }

    @Test
    void deleteHolding_shouldThrowWhenHoldingNotInPortfolio() {
        Portfolio ownedPortfolio = buildPortfolio("Owned", userId);
        UUID holdingId = UUID.randomUUID();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(ownedPortfolio));
        when(holdingRepository.findByIdAndPortfolioId(holdingId, portfolioId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.deleteHolding(portfolioId, holdingId, userId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Holding not found");

        verify(holdingRepository, never()).deleteById(any(UUID.class));
    }

    @Test
    void getAnalytics_whenPortfolioValueIsZero_shouldReturnSafeResponse() {
        Portfolio portfolio = buildPortfolio("Zero Portfolio", userId);
        Holding zeroHolding = Holding.builder()
                .portfolio(portfolio)
                .symbol("AAPL")
                .quantity(BigDecimal.ZERO)
                .averageCost(new BigDecimal("100"))
                .currentPrice(BigDecimal.ZERO)
                .sector("Technology")
                .build();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(portfolio));
        when(holdingRepository.findByPortfolioId(portfolioId)).thenReturn(List.of(zeroHolding));

        PortfolioAnalyticsResponse response = service.getAnalytics(portfolioId, userId);

        assertThat(response.totalMarketValue()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(response.holdingWeights()).isEmpty();
        assertThat(response.sectorAllocation()).isEmpty();
        assertThat(response.concentrationWarnings()).contains("Portfolio market value is zero");
    }

    /**
     * Builds portfolio.
     *
     * <p>This method belongs to {@link PortfolioServiceTest} and encapsulates the
     * build portfolio workflow.
     * @param name name (String)
     * @param ownerId owner id (UUID)
     * @return the build portfolio result (Portfolio)
     */

    private Portfolio buildPortfolio(String name, UUID ownerId) {
        User owner = User.builder().id(ownerId).username("user").build();

        return Portfolio.builder()
                .id(portfolioId).name(name).user(owner)
                .totalValue(BigDecimal.ZERO).holdings(new ArrayList<>())
                .createdAt(LocalDateTime.now()).build();
    }
}
