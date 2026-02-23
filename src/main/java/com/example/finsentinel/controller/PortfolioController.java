package com.example.finsentinel.controller;

import com.example.finsentinel.dto.portfolio.*;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.dto.risk.RiskReportSummary;
import com.example.finsentinel.mapper.RiskReportMapper;
import com.example.finsentinel.repository.RiskReportRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.PortfolioService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Exposes REST endpoints for portfolio controller operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@RestController
@RequestMapping("/api/portfolios")
@RequiredArgsConstructor
public class PortfolioController {

    private final PortfolioService portfolioService;
    private final UserRepository userRepository;
    private final RiskReportRepository riskReportRepository;
    private final RiskReportMapper riskReportMapper;

    /**
     * Executes create.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * create workflow.
     * @param request request (PortfolioRequest)
     * @param userDetails user details (UserDetails)
     * @return the create result (ResponseEntity<PortfolioResponse>)
     */

    @PostMapping
    public ResponseEntity<PortfolioResponse> create(

            @Valid @RequestBody PortfolioRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(portfolioService.create(request, resolveUserId(userDetails)));
    }

    /**
     * Executes list.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * list workflow.
     * @param userDetails user details (UserDetails)
     * @return the list result (ResponseEntity<List<PortfolioResponse>>)
     */

    @GetMapping
    public ResponseEntity<List<PortfolioResponse>> list(

            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.listByUser(resolveUserId(userDetails)));
    }

    /**
     * Executes get.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * get workflow.
     * @param id id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the get result (ResponseEntity<PortfolioResponse>)
     */

    @GetMapping("/{id}")
    public ResponseEntity<PortfolioResponse> get(

            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.getById(id, resolveUserId(userDetails)));
    }

    /**
     * Executes update.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * update workflow.
     * @param id id (UUID)
     * @param request request (PortfolioRequest)
     * @param userDetails user details (UserDetails)
     * @return the update result (ResponseEntity<PortfolioResponse>)
     */

    @PutMapping("/{id}")
    public ResponseEntity<PortfolioResponse> update(

            @PathVariable UUID id,
            @Valid @RequestBody PortfolioRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.update(id, request, resolveUserId(userDetails)));
    }

    /**
     * Executes delete.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * delete workflow.
     * @param id id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the delete result (ResponseEntity<Void>)
     */

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.delete(id, resolveUserId(userDetails));

        return ResponseEntity.noContent().build();
    }

    // --- Holding sub-resource ---

    /**
     * Executes add holding.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * add holding workflow.
     * @param portfolioId portfolio id (UUID)
     * @param request request (HoldingRequest)
     * @param userDetails user details (UserDetails)
     * @return the add holding result (ResponseEntity<HoldingResponse>)
     */

    @PostMapping("/{portfolioId}/holdings")
    public ResponseEntity<HoldingResponse> addHolding(

            @PathVariable UUID portfolioId,
            @Valid @RequestBody HoldingRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(portfolioService.addHolding(portfolioId, request, resolveUserId(userDetails)));
    }

    /**
     * Lists holdings.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * list holdings workflow.
     * @param portfolioId portfolio id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the list holdings result (ResponseEntity<List<HoldingResponse>>)
     */

    @GetMapping("/{portfolioId}/holdings")
    public ResponseEntity<List<HoldingResponse>> listHoldings(

            @PathVariable UUID portfolioId,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.listHoldings(portfolioId, resolveUserId(userDetails)));
    }

    /**
     * Updates holding.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * update holding workflow.
     * @param portfolioId portfolio id (UUID)
     * @param holdingId holding id (UUID)
     * @param request request (HoldingRequest)
     * @param userDetails user details (UserDetails)
     * @return the update holding result (ResponseEntity<HoldingResponse>)
     */

    @PutMapping("/{portfolioId}/holdings/{holdingId}")
    public ResponseEntity<HoldingResponse> updateHolding(

            @PathVariable UUID portfolioId,
            @PathVariable UUID holdingId,
            @Valid @RequestBody HoldingRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.updateHolding(

                portfolioId, holdingId, request, resolveUserId(userDetails)));
    }

    /**
     * Deletes holding.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * delete holding workflow.
     * @param portfolioId portfolio id (UUID)
     * @param holdingId holding id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the delete holding result (ResponseEntity<Void>)
     */

    @DeleteMapping("/{portfolioId}/holdings/{holdingId}")
    public ResponseEntity<Void> deleteHolding(
            @PathVariable UUID portfolioId,
            @PathVariable UUID holdingId,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.deleteHolding(portfolioId, holdingId, resolveUserId(userDetails));

        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/analytics")
    public ResponseEntity<PortfolioAnalyticsResponse> getAnalytics(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(portfolioService.getAnalytics(id, resolveUserId(userDetails)));
    }

    // --- Reports sub-resource ---

    /**
     * Lists reports.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * list reports workflow.
     * @param id id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the list reports result (ResponseEntity<List<RiskReportSummary>>)
     */

    @GetMapping("/{id}/reports")
    public ResponseEntity<List<RiskReportSummary>> listReports(
            @PathVariable UUID id,
            @AuthenticationPrincipal UserDetails userDetails) {
        portfolioService.getById(id, resolveUserId(userDetails));
        List<RiskReportSummary> summaries = riskReportRepository
                .findByPortfolioIdOrderByCreatedAtDesc(id)
                .stream()
                .map(entity -> {
                    RiskReport dto = riskReportMapper.toDto(entity);
                    return new RiskReportSummary(
                            entity.getId(),
                            dto.riskScore(),
                            dto.riskLevel(),
                            dto.summary(),
                            dto.factors(),
                            dto.actionableAdvice(),
                            dto.complianceNote(),
                            entity.getCreatedAt()
                    );
                })
                .toList();

        return ResponseEntity.ok(summaries);
    }

    /**
     * Executes resolve user id.
     *
     * <p>This method belongs to {@link PortfolioController} and encapsulates the
     * resolve user id workflow.
     * @param userDetails user details (UserDetails)
     * @return the resolve user id result (UUID)
     */

    private UUID resolveUserId(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"))
                .getId();
    }
}
